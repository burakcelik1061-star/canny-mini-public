import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { AUTH_THROTTLE } from '../../src/common/throttler.constants';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetDatabase } from './integration-app';

// Faz 7.4 — rate limiting'in GERÇEKTEN devrede olduğunun kanıtı.
//
// Diğer integration testleri THROTTLE_DISABLED=true ile koşuyor (aynı
// IP'den onlarca kayıt/giriş yaptıkları için limite takılırlardı — bkz.
// setup-env.ts). Bu dosya o bayrağı KAPATIYOR: yani "testler geçsin diye
// rate limiting devre dışı bırakıldı ve bir daha bakılmadı" durumu
// oluşmuyor, kapatma yolunun kendisi de burada test ediliyor.

describe('Rate limiting (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let previousFlag: string | undefined;

  beforeAll(async () => {
    previousFlag = process.env.THROTTLE_DISABLED;
    // skipIf istek anında okunuyor, uygulama kurulurken değil — bu yüzden
    // bayrağı burada değiştirmek yeterli.
    process.env.THROTTLE_DISABLED = 'false';

    ({ app, prisma } = await createIntegrationApp());
    http = app.getHttpServer() as App;
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
  });

  afterAll(async () => {
    // Sıradaki test dosyaları yine limitsiz koşabilsin diye eski değere
    // dönülüyor (jest maxWorkers=1, dosyalar sırayla çalışıyor).
    if (previousFlag === undefined) {
      delete process.env.THROTTLE_DISABLED;
    } else {
      process.env.THROTTLE_DISABLED = previousFlag;
    }
    await app.close();
  });

  it(`giriş ucu ${AUTH_THROTTLE.limit} denemeden sonra 429 döner (kaba kuvvet koruması)`, async () => {
    const attempt = () =>
      request(http)
        .post('/auth/login')
        .send({ email: 'yok@example.com', password: 'yanlis-sifre-123' });

    // Limite kadar olan denemeler normal şekilde reddedilmeli (401),
    // limitin ÜSTÜ 429 olmalı — yani 429 "yanlış şifre" ile karışmıyor.
    for (let i = 0; i < AUTH_THROTTLE.limit; i += 1) {
      await attempt().expect(401);
    }

    const blocked = await attempt().expect(429);
    expect((blocked.body as { message?: string }).message).toEqual(
      expect.any(String),
    );
  });

  it('429 yanıtı da requestId taşır', async () => {
    const attempt = () =>
      request(http)
        .post('/auth/login')
        .send({ email: 'yok2@example.com', password: 'yanlis-sifre-123' });

    for (let i = 0; i < AUTH_THROTTLE.limit; i += 1) {
      await attempt();
    }
    const blocked = await attempt().expect(429);

    expect((blocked.body as { requestId?: string }).requestId).toBe(
      blocked.headers['x-request-id'],
    );
  });

  // Genel limit (dakikada 120) auth limitinden çok daha geniş — auth
  // uçlarına konan @Throttle'ın gerçekten DAHA DAR olduğunu, yani
  // dekoratörün etkili olduğunu gösteriyor.
  it('auth dışı bir uç aynı sayıda istekte engellenmez', async () => {
    for (let i = 0; i < AUTH_THROTTLE.limit + 1; i += 1) {
      await request(http).get('/').expect(200);
    }
  });
});
