import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Prisma, User } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {
  createHash,
  createHmac,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from 'crypto';
import { InvitationsService } from '../organizations/invitations.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { WidgetIdentifyDto } from './dto/widget-identify.dto';
import { AuthTokens, JwtPayload } from './types/jwt-payload.type';

// Host'un imzasının ne kadar "eski" kabul edileceği — çok geniş bir pencere
// çalıntı/loglanmış bir identify isteğinin sonradan tekrar oynatılmasına
// (replay) izin verir, çok dar bir pencere de saat senkronizasyonu hafif
// kayan gerçek host'ları haksız yere reddeder. 5 dakika, JWT_ACCESS
// süresiyle (15dk) aynı büyüklük mertebesinde makul bir orta nokta.
const WIDGET_IDENTIFY_MAX_SKEW_MS = 5 * 60 * 1000;

const PASSWORD_SALT_ROUNDS = 12;

// Widget identify imzasının KANONİK mesajı. Alanlar ham `:` ile değil bir JSON
// dizisi olarak birleştiriliyor: `name` serbest metin (`:` içerebilir) olduğu
// için `email:name:timestamp` biçiminde alan sınırları belirsizdi. `email`
// IsEmail ile `:` içermese de kanonik/tipe-güvenli bir mesaj billing
// imzalarıyla (checkout:v1 / portal:v1) tutarlı. Host'un KENDİ backend'i bu
// mesajın BİREBİR aynısını üretmeli (bkz. admin Ayarlar sayfasındaki örnek).
export function widgetIdentifyMessage(
  email: string,
  name: string,
  timestamp: number,
): string {
  return 'widget-identify:v1:' + JSON.stringify([email, name, timestamp]);
}

export type SafeUser = Omit<User, 'password' | 'hashedRefreshToken'>;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly invitationsService: InvitationsService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async register(dto: RegisterDto): Promise<{
    user: SafeUser;
    tokens: AuthTokens;
  }> {
    const email = dto.email.toLowerCase().trim();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      // Hangi alanın çakıştığını (email var mı yok mu) belirtmek genelde
      // "user enumeration" riski taşır, ama register akışında zaten
      // kullanıcı kendi email'ini biliyor — burada sorun değil.
      throw new ConflictException('Bu email adresi zaten kayıtlı');
    }

    // Davet token'ı varsa, User'ı yazmadan ÖNCE geçerliliğini kontrol
    // ediyoruz — geçersiz/süresi dolmuş bir token yüzünden org'a hiç
    // katılamayacak yarım kalmış bir hesap oluşmasın.
    if (dto.invitationToken) {
      await this.invitationsService.assertRedeemable(
        dto.invitationToken,
        email,
      );
    }

    const hashedPassword = await bcrypt.hash(
      dto.password,
      PASSWORD_SALT_ROUNDS,
    );

    const user = await this.prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: dto.name.trim(),
      },
    });

    if (dto.invitationToken) {
      // Yukarıdaki assertRedeemable ile burası arasında (çok nadir) bir
      // yarış olursa redeemInvitation aynı kontrolleri tekrar çalıştırıp
      // güvenli şekilde reddeder — kullanıcı hesabı yine de oluşmuş olur,
      // ilgili org'a sonradan tekrar davet edilebilir.
      await this.invitationsService.redeemInvitation(dto.invitationToken, {
        id: user.id,
        email: user.email,
      });
    }

    const tokens = await this.issueTokens(user.id, user.email);
    await this.saveRefreshTokenHash(user.id, tokens.refreshToken);

    return { user: this.toSafeUser(user), tokens };
  }

  async login(dto: LoginDto): Promise<{ user: SafeUser; tokens: AuthTokens }> {
    const email = dto.email.toLowerCase().trim();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Kullanıcı yoksa da var-ama-şifre-yanlış durumuyla aynı mesajı/aynı
    // gecikmeyi vermeye çalışıyoruz ki "bu email kayıtlı mı" bilgisi sızmasın.
    if (!user) {
      throw new UnauthorizedException('Email veya şifre hatalı');
    }

    const passwordMatches = await bcrypt.compare(dto.password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Email veya şifre hatalı');
    }

    const tokens = await this.issueTokens(user.id, user.email);
    await this.saveRefreshTokenHash(user.id, tokens.refreshToken);

    return { user: this.toSafeUser(user), tokens };
  }

  // Faz 4.3 — widget "identify" (SSO): widget'ı gömen sitenin KENDİ backend'i
  // `org.widgetSecret`'ı (GET /organizations/:orgId/widget-settings ile org
  // admin'ine gösteriliyor) HMAC anahtarı olarak kullanıp kanonik identify
  // mesajını (bkz. widgetIdentifyMessage) imzalar — bu imza tarayıcıda asla
  // hesaplanmaz (secret host'un backend'inde kalır), widget sadece hazır
  // imzayı iletir. Burada doğrulanan şey "bu email gerçekten host'un kendi
  // sunucusu tarafından onaylandı" — normal login/register'ın aksine şifre
  // yok, host zaten kendi kullanıcısını doğrulamış.
  //
  // Başarılı bir identify org ÜYELİĞİ vermez (OrganizationMember
  // oluşturulmaz) — sadece normal bir end-user User kaydı bulur/oluşturur,
  // "Post oluşturmak org üyeliği gerektirmez" kararıyla
  // aynı çizgide.
  async identifyWidgetUser(
    orgSlug: string,
    dto: WidgetIdentifyDto,
  ): Promise<{ user: SafeUser; accessToken: string }> {
    const { widgetSecret } =
      await this.organizationsService.getOrgWidgetSecret(orgSlug);

    if (Math.abs(Date.now() - dto.timestamp) > WIDGET_IDENTIFY_MAX_SKEW_MS) {
      throw new UnauthorizedException('Identify isteğinin süresi dolmuş');
    }

    const expectedSignature = createHmac('sha256', widgetSecret)
      .update(widgetIdentifyMessage(dto.email, dto.name, dto.timestamp))
      .digest('hex');
    if (!this.hexStringsMatch(dto.signature, expectedSignature)) {
      throw new UnauthorizedException('Geçersiz identify imzası');
    }

    const email = dto.email.toLowerCase().trim();
    let user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Bu kullanıcı hiç şifre girmedi — normal /auth/login ile ASLA
      // eşleşmeyecek, kimsenin bilmediği rastgele bir bcrypt hash (hesaba
      // sadece tekrar identify edilerek "giriş" yapılabilir).
      const unusablePassword = randomBytes(32).toString('hex');
      const hashedPassword = await bcrypt.hash(
        unusablePassword,
        PASSWORD_SALT_ROUNDS,
      );
      try {
        user = await this.prisma.user.create({
          data: { email, password: hashedPassword, name: dto.name.trim() },
        });
      } catch (error) {
        // Aynı identify token'ıyla (aynı imza/timestamp) İKİ isteğin neredeyse
        // eşzamanlı gelmesi (ör. widget'ın React StrictMode'daki çift efekt
        // çalıştırması dev'de, ya da host sayfası widget'ı iki yerde
        // gömdüyse) findUnique-create arasında bir yarışa yol açabilir —
        // OrganizationsService.generateUniqueSlug'daki aynı savunma deseni:
        // DB'nin unique constraint'i son hakem, kaybeden istek az önce
        // OLUŞMUŞ kullanıcıyı bulup onunla devam eder.
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          const existing = await this.prisma.user.findUnique({
            where: { email },
          });
          if (!existing) {
            throw error; // beklenmedik durum — hatayı yut(ma)ma, sızdır
          }
          user = existing;
        } else {
          throw error;
        }
      }
    }

    const tokens = await this.issueTokens(user.id, user.email);
    await this.saveRefreshTokenHash(user.id, tokens.refreshToken);
    return { user: this.toSafeUser(user), accessToken: tokens.accessToken };
  }

  async refreshTokens(
    userId: string,
    refreshToken: string,
  ): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.hashedRefreshToken) {
      throw new ForbiddenException('Erişim reddedildi');
    }

    if (!this.refreshTokenMatches(refreshToken, user.hashedRefreshToken)) {
      // Reuse detection: bu noktaya gelen token JwtRefreshGuard'dan geçmiş
      // (imza geçerli, süresi dolmamış) AMA saklanan hash'le eşleşmiyor —
      // yani rotate edilmiş/eski bir refresh token yeniden sunuluyor (klasik
      // token-hırsızlığı göstergesi). Tek bir isteği reddetmek yerine TÜM
      // oturumu iptal ediyoruz (hashedRefreshToken = null): hem meşru kullanıcı
      // hem saldırgan yeniden giriş yapmak zorunda kalır. Aksi halde saldırgan,
      // çaldığı ama henüz rotate edilmemiş geçerli bir token'la sessizce devam
      // edebilirdi.
      await this.logout(user.id);
      throw new ForbiddenException('Erişim reddedildi');
    }

    // Rotation: her refresh'te yeni bir refresh token üretilir ve öncekinin
    // hash'i değiştirilir — çalınan eski bir refresh token tekrar kullanılamaz.
    const tokens = await this.issueTokens(user.id, user.email);
    await this.saveRefreshTokenHash(user.id, tokens.refreshToken);

    return tokens;
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { id: userId, hashedRefreshToken: { not: null } },
      data: { hashedRefreshToken: null },
    });
  }

  async getSafeUserById(userId: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.toSafeUser(user);
  }

  private async issueTokens(
    userId: string,
    email: string,
  ): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
        // ms() tabanlı literal tip (StringValue) yerine env'den gelen düz
        // string kullanıyoruz — runtime'da jsonwebtoken bunu doğru parse eder.
        expiresIn: this.configService.get<string>(
          'JWT_ACCESS_EXPIRES_IN',
          '15m',
        ) as unknown as number,
      }),
      // jti — Faz 7.1'de integration testi (auth.integration-spec.ts →
      // "kullanılmış bir refresh token ikinci kez kabul edilmez") tarafından
      // ortaya çıkarılan gerçek bir açık: JWT'nin `iat`/`exp` alanları SANİYE
      // çözünürlüğünde, payload'ın geri kalanı ({sub, email}) da sabit
      // olduğu için AYNI SANİYE içinde üretilen iki refresh token birebir
      // aynı string oluyordu. Bu durumda rotation hiçbir şeyi geçersiz
      // kılmıyor — çalıntı bir token o pencerede hâlâ geçerli kalıyordu,
      // oysa tasarım kararı "refresh token tek kullanımlıktır". Rastgele
      // bir jti her token'ı benzersiz kılıyor. Sadece refresh token'a
      // ekleniyor: access token stateless ve zaten rotate edilmiyor.
      this.jwtService.signAsync(
        { ...payload, jti: randomUUID() },
        {
          secret: this.configService.get<string>('JWT_REFRESH_SECRET'),
          expiresIn: this.configService.get<string>(
            'JWT_REFRESH_EXPIRES_IN',
            '7d',
          ) as unknown as number,
        },
      ),
    ]);

    return { accessToken, refreshToken };
  }

  private async saveRefreshTokenHash(userId: string, refreshToken: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: { hashedRefreshToken: this.hashRefreshToken(refreshToken) },
    });
  }

  // Refresh token'lar (parolaların aksine) kullanıcı tarafından seçilmeyen,
  // yüksek entropili JWT'ler — bcrypt'in yavaş/salted brute-force koruması
  // burada gereksiz, üstelik zararlı: bcrypt girdiyi ilk 72 byte'a kırpıyor
  // ve JWT'lerin "sub"/"email" claim'leri sabit kaldığı için farklı
  // token'lar (sadece iat/exp farkıyla) 72 byte sınırından SONRA ayrışıyor —
  // yani bcrypt ile hashlenip karşılaştırıldığında yanlışlıkla "eşleşmiş"
  // görünüyorlardı ve rotation eski token'ı geçersiz kılmıyordu. SHA-256 +
  // sabit-zamanlı karşılaştırma bu sorunu ortadan kaldırıyor.
  private hashRefreshToken(refreshToken: string): string {
    return createHash('sha256').update(refreshToken).digest('hex');
  }

  private refreshTokenMatches(
    refreshToken: string,
    storedHash: string,
  ): boolean {
    const candidateHash = Buffer.from(
      this.hashRefreshToken(refreshToken),
      'hex',
    );
    const actualHash = Buffer.from(storedHash, 'hex');
    return (
      candidateHash.length === actualHash.length &&
      timingSafeEqual(candidateHash, actualHash)
    );
  }

  // refreshTokenMatches ile aynı zamanlama-güvenli karşılaştırma deseni —
  // identifyWidgetUser'ın HMAC imza kontrolü için de kullanılıyor (naif
  // `===` string karşılaştırması timing attack'e açık olurdu).
  private hexStringsMatch(a: string, b: string): boolean {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }

  // Bilinçli olarak "omit" yerine "pick" yaklaşımı: yarın User modeline yeni
  // bir hassas alan eklenirse (örn. 2FA secret), burada unutulup otomatik
  // sızması yerine, açıkça eklenmediği sürece response'a hiç girmez.
  private toSafeUser(user: User): SafeUser {
    const { id, email, name, createdAt, updatedAt } = user;
    return { id, email, name, createdAt, updatedAt };
  }
}
