import {
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { createHash, createHmac } from 'crypto';
import { InvitationsService } from '../organizations/invitations.service';
import { OrganizationsService } from '../organizations/organizations.service';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

jest.mock('bcryptjs', () => ({
  hash: jest.fn(),
  compare: jest.fn(),
}));

// AuthService içindeki private hashRefreshToken ile aynı algoritma —
// refresh token senaryolarında beklenen hash'i üretmek için kullanılıyor.
const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const mockUser = {
  id: 'user-1',
  email: 'test@example.com',
  password: 'hashed-password',
  name: 'Test User',
  hashedRefreshToken: null as string | null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('AuthService', () => {
  let service: AuthService;
  let prisma: {
    user: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
  };
  let invitationsService: {
    assertRedeemable: jest.Mock;
    redeemInvitation: jest.Mock;
  };
  let organizationsService: {
    getOrgWidgetSecret: jest.Mock;
  };
  let jwtService: { signAsync: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    };
    invitationsService = {
      assertRedeemable: jest.fn().mockResolvedValue(undefined),
      redeemInvitation: jest
        .fn()
        .mockResolvedValue({ organizationId: 'org-1', role: 'MEMBER' }),
    };
    organizationsService = {
      getOrgWidgetSecret: jest
        .fn()
        .mockResolvedValue({ id: 'org-1', widgetSecret: 'the-widget-secret' }),
    };
    jwtService = { signAsync: jest.fn().mockResolvedValue('signed-jwt') };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(
              (key: string, fallback?: string) => fallback ?? `mock-${key}`,
            ),
          },
        },
        { provide: InvitationsService, useValue: invitationsService },
        { provide: OrganizationsService, useValue: organizationsService },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    jest.clearAllMocks();
  });

  describe('register', () => {
    it('var olan email ile ConflictException fırlatır', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);

      await expect(
        service.register({
          email: mockUser.email,
          password: 'password123',
          name: 'Test User',
        }),
      ).rejects.toThrow(ConflictException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('yeni kullanıcı için şifreyi hashler, plaintext saklamaz ve token döner', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.register({
        email: 'Test@Example.com', // normalize edilmeli
        password: 'password123',
        name: 'Test User',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('password123', 12);
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest.fn() mock çağrı argümanları any */
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'test@example.com',
            password: 'hashed-password',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      // Refresh token DB'ye ham haliyle değil, hash'lenmiş olarak yazılmalı.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { hashedRefreshToken: sha256('signed-jwt') },
        }),
      );
      expect(result.user).not.toHaveProperty('password');
      expect(result.user).not.toHaveProperty('hashedRefreshToken');
      expect(result.tokens.accessToken).toBe('signed-jwt');
      expect(result.tokens.refreshToken).toBe('signed-jwt');
    });

    it('invitationToken geçersizse kullanıcı hiç oluşturulmaz', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      invitationsService.assertRedeemable.mockRejectedValue(
        new ForbiddenException(
          'Bu davet başka bir email adresi için gönderilmiş',
        ),
      );

      await expect(
        service.register({
          email: 'test@example.com',
          password: 'password123',
          name: 'Test User',
          invitationToken: 'bad-token',
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(prisma.user.create).not.toHaveBeenCalled();
    });

    it('invitationToken geçerliyse kullanıcı oluşturulduktan sonra davet redeem edilir', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed-password');
      prisma.user.create.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      await service.register({
        email: mockUser.email,
        password: 'password123',
        name: 'Test User',
        invitationToken: 'good-token',
      });

      expect(invitationsService.assertRedeemable).toHaveBeenCalledWith(
        'good-token',
        mockUser.email,
      );
      expect(invitationsService.redeemInvitation).toHaveBeenCalledWith(
        'good-token',
        { id: mockUser.id, email: mockUser.email },
      );
    });
  });

  describe('login', () => {
    it('kullanıcı bulunamazsa UnauthorizedException fırlatır', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.login({ email: 'nope@example.com', password: 'whatever' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('şifre yanlışsa UnauthorizedException fırlatır', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);

      await expect(
        service.login({ email: mockUser.email, password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('doğru kimlik bilgileriyle token çifti döner', async () => {
      prisma.user.findUnique.mockResolvedValue(mockUser);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.login({
        email: mockUser.email,
        password: 'correct-password',
      });

      expect(result.tokens.accessToken).toBe('signed-jwt');
      expect(result.tokens.refreshToken).toBe('signed-jwt');
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { hashedRefreshToken: sha256('signed-jwt') },
        }),
      );
    });
  });

  describe('refreshTokens', () => {
    it("kullanıcının kayıtlı refresh token hash'i yoksa ForbiddenException fırlatır", async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: null,
      });

      await expect(
        service.refreshTokens('user-1', 'some-token'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('refresh token hash ile eşleşmezse ForbiddenException fırlatır (örn. rotation sonrası eski token tekrar kullanılırsa)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: sha256('the-current-valid-token'),
      });

      await expect(
        service.refreshTokens('user-1', 'a-stale-token'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('reuse detection: eşleşmeyen (rotate edilmiş/çalıntı) bir token TÜM oturumu iptal eder', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: sha256('the-current-valid-token'),
      });

      await expect(
        service.refreshTokens('user-1', 'a-stale-token'),
      ).rejects.toThrow(ForbiddenException);

      // Sadece isteği reddetmekle kalmıyor, hashedRefreshToken'ı null'lıyor —
      // meşru kullanıcının HÂLÂ geçerli olan güncel token'ı da geçersizleşir,
      // yani saldırgan çaldığı token'la sessizce devam edemez.
      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', hashedRefreshToken: { not: null } },
        data: { hashedRefreshToken: null },
      });
    });

    it("72 byte'tan uzun, sadece sonu farklı iki token birbiriyle karıştırılmaz (regression: bcrypt 72-byte kırpma sorunu)", async () => {
      // Gerçek JWT'lerdeki durumu simüle ediyor: aynı sabit önek (>72 byte),
      // sadece sonda (iat/exp karşılığı) farklılaşan iki token.
      const commonPrefix = 'a'.repeat(100);
      const tokenA = `${commonPrefix}.suffix-A`;
      const tokenB = `${commonPrefix}.suffix-B`;

      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: sha256(tokenB),
      });

      await expect(service.refreshTokens('user-1', tokenA)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('geçerli refresh token ile yeni token çifti üretir (rotation)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: sha256('valid-token'),
      });
      prisma.user.update.mockResolvedValue(mockUser);

      const tokens = await service.refreshTokens('user-1', 'valid-token');

      expect(tokens.accessToken).toBe('signed-jwt');
      // Yeni üretilen refresh token da (mock JwtService 'signed-jwt' döner)
      // hash'lenerek DB'ye yazılmalı — rotation.
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { hashedRefreshToken: sha256('signed-jwt') },
        }),
      );
    });

    // Faz 7.1 regresyonu: refresh token payload'ı bir zamanlar sadece
    // {sub, email} idi — JWT'nin iat/exp alanları saniye çözünürlüğünde
    // olduğu için aynı saniyede üretilen iki token birebir AYNI string
    // çıkıyor ve rotation hiçbir şeyi geçersiz kılmıyordu (integration
    // testinde yakalandı, bkz. auth.service.ts → issueTokens/jti).
    it('her refresh token benzersiz bir jti ile imzalanır (access token’a eklenmez)', async () => {
      prisma.user.findUnique.mockResolvedValue({
        ...mockUser,
        hashedRefreshToken: sha256('valid-token'),
      });
      prisma.user.update.mockResolvedValue(mockUser);

      await service.refreshTokens('user-1', 'valid-token');
      await service.refreshTokens('user-1', 'valid-token');

      const payloads = jwtService.signAsync.mock.calls.map(
        ([payload]) => payload as { jti?: string },
      );
      const jtis = payloads
        .map((payload) => payload.jti)
        .filter((jti): jti is string => Boolean(jti));

      // İki çağrının her biri access + refresh imzalıyor → 4 payload;
      // bunlardan sadece 2'si (refresh) jti taşımalı ve ikisi farklı olmalı.
      expect(payloads).toHaveLength(4);
      expect(jtis).toHaveLength(2);
      expect(new Set(jtis).size).toBe(2);
    });
  });

  describe('logout', () => {
    it('kullanıcının hashedRefreshToken alanını temizler', async () => {
      prisma.user.updateMany.mockResolvedValue({ count: 1 });

      await service.logout('user-1');

      expect(prisma.user.updateMany).toHaveBeenCalledWith({
        where: { id: 'user-1', hashedRefreshToken: { not: null } },
        data: { hashedRefreshToken: null },
      });
    });
  });

  // Faz 4.3 — widget "identify": host'un KENDİ backend'inin org.widgetSecret
  // ile imzaladığı bir payload'ı doğrulayıp normal bir accessToken'a çeviren
  // akış. sign() burada testin "host backend'i" rolünü oynuyor — gerçek
  // signature üretimi asla tarayıcıda/widget'ta olmaz (bkz. AuthService
  // yorumu), test de bunu taklit ediyor.
  describe('identifyWidgetUser', () => {
    function sign(email: string, name: string, timestamp: number): string {
      // Host backend'inin ürettiği KANONİK mesaj (auth.service.ts →
      // widgetIdentifyMessage ile birebir aynı olmalı) — testin bağımsız bir
      // "dış imzalayan" temsil etmesi için burada elle yeniden yazılıyor.
      return createHmac('sha256', 'the-widget-secret')
        .update(
          'widget-identify:v1:' + JSON.stringify([email, name, timestamp]),
        )
        .digest('hex');
    }

    it('geçerli imzayla mevcut bir kullanıcı için token döner (yeni kullanıcı oluşturmaz)', async () => {
      const timestamp = Date.now();
      prisma.user.findUnique.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.identifyWidgetUser('acme', {
        email: mockUser.email,
        name: mockUser.name,
        timestamp,
        signature: sign(mockUser.email, mockUser.name, timestamp),
      });

      expect(organizationsService.getOrgWidgetSecret).toHaveBeenCalledWith(
        'acme',
      );
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(result.accessToken).toBe('signed-jwt');
      expect(result.user.email).toBe(mockUser.email);
    });

    it('kullanıcı yoksa şifresiz (rastgele hash) yeni bir User oluşturur', async () => {
      const timestamp = Date.now();
      prisma.user.findUnique.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('unusable-random-hash');
      prisma.user.create.mockResolvedValue(mockUser);
      prisma.user.update.mockResolvedValue(mockUser);

      await service.identifyWidgetUser('acme', {
        email: 'new-end-user@example.com',
        name: 'New End User',
        timestamp,
        signature: sign('new-end-user@example.com', 'New End User', timestamp),
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest.fn() mock çağrı argümanları any */
      expect(prisma.user.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            email: 'new-end-user@example.com',
            password: 'unusable-random-hash',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it('yanlış imzayla UnauthorizedException fırlatır (secret bilinmeden imza üretilemez)', async () => {
      const timestamp = Date.now();

      await expect(
        service.identifyWidgetUser('acme', {
          email: mockUser.email,
          name: mockUser.name,
          timestamp,
          signature: 'f'.repeat(64), // rastgele/yanlış — the-widget-secret ile üretilmedi
        }),
      ).rejects.toThrow(UnauthorizedException);

      expect(prisma.user.findUnique).not.toHaveBeenCalled();
    });

    it("çok eski bir timestamp'le (replay) UnauthorizedException fırlatır", async () => {
      const staleTimestamp = Date.now() - 10 * 60 * 1000; // 10 dakika önce (>5dk penceresi)

      await expect(
        service.identifyWidgetUser('acme', {
          email: mockUser.email,
          name: mockUser.name,
          timestamp: staleTimestamp,
          signature: sign(mockUser.email, mockUser.name, staleTimestamp),
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('eşzamanlı iki istek aynı email için user.create yarışırsa (P2002) kaybeden istek yeni oluşturulan kullanıcıyı bulup onunla devam eder', async () => {
      // Gerçek dünyadaki tetikleyici: widget'ın React StrictMode'daki çift
      // efekt çalıştırması (dev'de) ya da aynı sayfada iki embed — ikisi de
      // aynı findUnique(null) sonucunu görüp aynı anda create'e gidebilir.
      const timestamp = Date.now();
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // ilk findUnique: kullanıcı henüz yok
        .mockResolvedValueOnce(mockUser); // create P2002 ile patlayınca tekrar bak: şimdi var (diğer istek oluşturdu)
      (bcrypt.hash as jest.Mock).mockResolvedValue('unusable-random-hash');
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );
      prisma.user.update.mockResolvedValue(mockUser);

      const result = await service.identifyWidgetUser('acme', {
        email: mockUser.email,
        name: mockUser.name,
        timestamp,
        signature: sign(mockUser.email, mockUser.name, timestamp),
      });

      expect(result.user.email).toBe(mockUser.email);
      expect(result.accessToken).toBe('signed-jwt');
    });

    it("başka bir org'ın secret'ıyla üretilmiş bir imza reddedilir (org izolasyonu)", async () => {
      const timestamp = Date.now();
      const signedWithWrongSecret = createHmac(
        'sha256',
        'a-different-org-secret',
      )
        .update(
          'widget-identify:v1:' +
            JSON.stringify([mockUser.email, mockUser.name, timestamp]),
        )
        .digest('hex');

      await expect(
        service.identifyWidgetUser('acme', {
          email: mockUser.email,
          name: mockUser.name,
          timestamp,
          signature: signedWithWrongSecret,
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
