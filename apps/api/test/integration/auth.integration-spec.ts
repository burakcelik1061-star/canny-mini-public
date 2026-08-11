import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetDatabase } from './integration-app';
import { createOrg, extractRefreshCookie, registerUser } from './fixtures';

// Faz 7.1 — auth'un GERÇEK HTTP + GERÇEK Postgres üzerinden doğrulanması.
// auth.service.spec.ts (unit) aynı mantığı Prisma mock'lanarak test ediyor;
// buradaki testlerin eklediği şey, unit testlerin yapısal olarak
// kanıtlayamadığı katmanlar: guard'ların route'lara gerçekten bağlı olması,
// ValidationPipe'ın gerçekten devrede olması, refresh cookie'sinin gerçekten
// set edilmesi ve token rotation'ın gerçek bir DB satırı üzerinden çalışması.

describe('Auth (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;

  beforeAll(async () => {
    ({ app, prisma } = await createIntegrationApp());
    http = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /auth/register', () => {
    it('kullanıcıyı oluşturur, şifreyi bcrypt ile hashler ve plaintext saklamaz', async () => {
      const password = 'correct-horse-battery';
      const response = await request(http)
        .post('/auth/register')
        .send({ email: 'new@example.com', password, name: 'Yeni Kullanıcı' })
        .expect(201);

      const body = response.body as {
        user: { id: string; email: string; password?: string };
        accessToken: string;
      };
      expect(body.accessToken).toEqual(expect.any(String));
      // Response'ta şifre alanı HİÇ olmamalı (SafeUser).
      expect(body.user).not.toHaveProperty('password');

      const stored = await prisma.user.findUnique({
        where: { email: 'new@example.com' },
      });
      expect(stored).not.toBeNull();
      expect(stored!.password).not.toBe(password);
      expect(stored!.password).toMatch(/^\$2[aby]\$/); // bcrypt hash biçimi
    });

    it('refresh token’ı httpOnly cookie olarak set eder, response gövdesine koymaz', async () => {
      const response = await request(http)
        .post('/auth/register')
        .send({
          email: 'cookie@example.com',
          password: 'correct-horse-battery',
          name: 'Cookie',
        })
        .expect(201);

      expect(response.body).not.toHaveProperty('refreshToken');

      const cookies = response.headers['set-cookie'] as unknown as string[];
      const refresh = cookies.find((c) => c.startsWith('refreshToken='))!;
      expect(refresh).toBeDefined();
      expect(refresh).toContain('HttpOnly');
      expect(refresh).toContain('Path=/auth');
    });

    it('aynı email ikinci kez kayıt olamaz (409)', async () => {
      const payload = {
        email: 'dupe@example.com',
        password: 'correct-horse-battery',
        name: 'Dupe',
      };
      await request(http).post('/auth/register').send(payload).expect(201);
      await request(http).post('/auth/register').send(payload).expect(409);

      expect(await prisma.user.count({ where: { email: payload.email } })).toBe(
        1,
      );
    });

    // Bu üç test doğrudan main.ts/app-setup.ts'teki global ValidationPipe'ı
    // hedefliyor — unit testler DTO dekoratörlerinin gerçekten uygulandığını
    // hiçbir zaman görmez (servis metodu düz bir obje alır).
    it('geçersiz email 400 döner ve kullanıcı oluşturmaz', async () => {
      await request(http)
        .post('/auth/register')
        .send({
          email: 'email-degil',
          password: 'correct-horse-battery',
          name: 'X',
        })
        .expect(400);

      expect(await prisma.user.count()).toBe(0);
    });

    it('8 karakterden kısa şifre 400 döner', async () => {
      await request(http)
        .post('/auth/register')
        .send({ email: 'short@example.com', password: 'kisa', name: 'X' })
        .expect(400);
    });

    it('DTO’da tanımlı olmayan bir alan gönderilirse 400 döner (forbidNonWhitelisted)', async () => {
      await request(http)
        .post('/auth/register')
        .send({
          email: 'extra@example.com',
          password: 'correct-horse-battery',
          name: 'X',
          role: 'ADMIN', // yetki yükseltme denemesi — sessizce yok sayılmamalı
        })
        .expect(400);
    });
  });

  describe('POST /auth/login', () => {
    it('doğru kimlik bilgileriyle accessToken döner', async () => {
      const user = await registerUser(app);

      const response = await request(http)
        .post('/auth/login')
        .send({ email: user.email, password: user.password })
        .expect(200);

      expect((response.body as { accessToken: string }).accessToken).toEqual(
        expect.any(String),
      );
    });

    it('yanlış şifre 401 döner', async () => {
      const user = await registerUser(app);

      await request(http)
        .post('/auth/login')
        .send({ email: user.email, password: 'yanlis-sifre-123' })
        .expect(401);
    });

    it('var olmayan kullanıcı da 401 döner (kullanıcı sayımı sızdırılmaz)', async () => {
      await request(http)
        .post('/auth/login')
        .send({ email: 'yok@example.com', password: 'correct-horse-battery' })
        .expect(401);
    });
  });

  describe('POST /auth/refresh — rotation', () => {
    it('geçerli refresh cookie ile yeni bir access token verir', async () => {
      const user = await registerUser(app);

      const response = await request(http)
        .post('/auth/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(200);

      expect((response.body as { accessToken: string }).accessToken).toEqual(
        expect.any(String),
      );
    });

    // Rotation'ın mutlu yolu: güncel token her seferinde yenisiyle değişir
    // (eski token'ı hiç yeniden sunmadan zincir çalışır).
    it('rotation: güncel token art arda yenilenebilir', async () => {
      const user = await registerUser(app);

      const first = await request(http)
        .post('/auth/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(200);
      const cookieB = extractRefreshCookie(first);

      await request(http)
        .post('/auth/refresh')
        .set('Cookie', cookieB)
        .expect(200);
    });

    // Reuse detection: rotation'ın TEK KULLANIMLIK olduğunu ve bir hırsızlık
    // göstergesinde tüm oturumun iptal edildiğini DB'ye yazılan hash üzerinden
    // kanıtlıyoruz. Eski (kullanılmış) bir token yeniden sunulursa sadece o
    // istek değil, meşru kullanıcının HÂLÂ geçerli olan güncel token'ı da
    // geçersizleşir — saldırgan çaldığı token'la sessizce devam edemesin.
    it('reuse detection: eski bir token yeniden kullanılırsa güncel token da dahil oturum iptal olur', async () => {
      const user = await registerUser(app);

      const first = await request(http)
        .post('/auth/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(200);
      const rotatedCookie = extractRefreshCookie(first);

      // Eski (kullanılmış) token yeniden sunuluyor — reddedilir...
      await request(http)
        .post('/auth/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(403);

      // ...ve reuse tespiti GÜNCEL token'ı da geçersiz kılar.
      await request(http)
        .post('/auth/refresh')
        .set('Cookie', rotatedCookie)
        .expect(403);

      // DB'de hash gerçekten null (oturum tamamen iptal).
      expect(
        (await prisma.user.findUnique({ where: { id: user.id } }))!
          .hashedRefreshToken,
      ).toBeNull();
    });

    it('cookie yoksa 401 döner (JwtRefreshGuard route’a gerçekten bağlı)', async () => {
      await request(http).post('/auth/refresh').expect(401);
    });

    it('logout sonrası refresh token geçersizleşir', async () => {
      const user = await registerUser(app);

      await request(http)
        .post('/auth/logout')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(
        (await prisma.user.findUnique({ where: { id: user.id } }))!
          .hashedRefreshToken,
      ).toBeNull();

      await request(http)
        .post('/auth/refresh')
        .set('Cookie', user.refreshCookie)
        .expect(403);
    });
  });

  describe('GET /auth/me — JwtAccessGuard', () => {
    it('token’sız 401 döner', async () => {
      await request(http).get('/auth/me').expect(401);
    });

    it('bozuk token 401 döner', async () => {
      await request(http)
        .get('/auth/me')
        .set('Authorization', 'Bearer bu-bir-jwt-degil')
        .expect(401);
    });

    it('geçerli token ile şifresiz kullanıcı bilgisi döner', async () => {
      const user = await registerUser(app);

      const response = await request(http)
        .get('/auth/me')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const body = response.body as { id: string; email: string };
      expect(body.id).toBe(user.id);
      expect(body.email).toBe(user.email);
      expect(body).not.toHaveProperty('password');
      expect(body).not.toHaveProperty('hashedRefreshToken');
    });
  });

  describe('POST /widget/:orgSlug/identify — HMAC SSO (4.3)', () => {
    function sign(secret: string, email: string, name: string, ts: number) {
      // Host backend'inin ürettiği KANONİK mesaj (auth.service.ts →
      // widgetIdentifyMessage ile birebir aynı). "Dış imzalayan" tarafı
      // bağımsız temsil etmek için elle yeniden yazıldı.
      return createHmac('sha256', secret)
        .update('widget-identify:v1:' + JSON.stringify([email, name, ts]))
        .digest('hex');
    }

    it('geçerli imzayla kullanıcıyı oluşturur ve token döner', async () => {
      const org = await createOrg(prisma);
      const timestamp = Date.now();
      const email = 'host-user@example.com';
      const name = 'Host User';

      const response = await request(http)
        .post(`/widget/${org.slug}/identify`)
        .send({
          email,
          name,
          timestamp,
          signature: sign(org.widgetSecret, email, name, timestamp),
        })
        .expect(200);

      expect((response.body as { accessToken: string }).accessToken).toEqual(
        expect.any(String),
      );
      expect(await prisma.user.findUnique({ where: { email } })).not.toBeNull();
    });

    it('başka bir org’un secret’ıyla üretilmiş imza reddedilir (org izolasyonu)', async () => {
      const orgA = await createOrg(prisma);
      const orgB = await createOrg(prisma);
      const timestamp = Date.now();
      const email = 'cross@example.com';
      const name = 'Cross';

      await request(http)
        .post(`/widget/${orgA.slug}/identify`)
        .send({
          email,
          name,
          timestamp,
          signature: sign(orgB.widgetSecret, email, name, timestamp),
        })
        .expect(401);

      expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
    });

    it('süresi geçmiş bir timestamp (replay) reddedilir', async () => {
      const org = await createOrg(prisma);
      const timestamp = Date.now() - 10 * 60 * 1000; // 10 dk önce
      const email = 'replay@example.com';
      const name = 'Replay';

      await request(http)
        .post(`/widget/${org.slug}/identify`)
        .send({
          email,
          name,
          timestamp,
          signature: sign(org.widgetSecret, email, name, timestamp),
        })
        .expect(401);
    });
  });

  // 4.3'te canlı yakalanan bir sızıntının regresyon testi.
  // Bu, unit testlerin PRENSİP OLARAK yakalayamayacağı bir hata sınıfı:
  // sızıntı Prisma client'ın yapılandırmasındaydı, servis mantığında değil —
  // mock'lanmış bir Prisma her zaman "sızdırmıyor" görünür.
  describe('widgetSecret sızıntısı (regresyon)', () => {
    it('GET /organizations org üyesine widgetSecret döndürmez', async () => {
      const user = await registerUser(app);
      const org = await createOrg(prisma, { ownerId: user.id });

      const response = await request(http)
        .get('/organizations')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const orgs = response.body as Record<string, unknown>[];
      expect(orgs).toHaveLength(1);
      expect(orgs[0].id).toBe(org.id);
      expect(orgs[0]).not.toHaveProperty('widgetSecret');
      expect(JSON.stringify(response.body)).not.toContain(org.widgetSecret);
    });
  });
});
