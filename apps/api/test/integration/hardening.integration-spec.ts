import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetDatabase } from './integration-app';
import { createOrg, registerUser } from './fixtures';

// Faz 7.4 — "production'a hazır" pratiklerinin GERÇEKTEN devrede olduğunun
// kanıtı. Bunlar tam olarak unit testin gösteremeyeceği türden şeyler:
// hepsi global bir guard/filtre/middleware olarak UYGULAMAYA BAĞLANMIŞ
// olmalarına dayanıyor — sınıfların kendisi doğru çalışsa bile bağlanmamış
// olsalar hiçbir işe yaramazlardı.

describe('Hardening (integration)', () => {
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

  describe('güvenlik başlıkları (helmet)', () => {
    it('yanıtlarda helmet başlıkları var', async () => {
      const response = await request(http).get('/').expect(200);

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['referrer-policy']).toBeDefined();
      // helmet Express'in varsayılan "biz Express'iz" başlığını kaldırır.
      expect(response.headers['x-powered-by']).toBeUndefined();
    });
  });

  describe('request id', () => {
    it('her yanıta bir x-request-id başlığı ekler', async () => {
      const response = await request(http).get('/').expect(200);

      expect(response.headers['x-request-id']).toMatch(
        /^[0-9a-f-]{36}$/, // randomUUID
      );
    });

    it('iki farklı istek farklı id alır', async () => {
      const first = await request(http).get('/').expect(200);
      const second = await request(http).get('/').expect(200);

      expect(first.headers['x-request-id']).not.toBe(
        second.headers['x-request-id'],
      );
    });

    // Gerçek bir kurulumda id'yi önündeki proxy üretmiş olabilir; üzerine
    // yazmak izleme zincirini koparırdı.
    it('gelen x-request-id korunur, üzerine yazılmaz', async () => {
      const response = await request(http)
        .get('/')
        .set('x-request-id', 'upstream-tarafindan-uretilmis')
        .expect(200);

      expect(response.headers['x-request-id']).toBe(
        'upstream-tarafindan-uretilmis',
      );
    });
  });

  describe('hata gövdeleri', () => {
    it('hata yanıtları requestId taşır (kullanıcı bildirdiğinde log’da aranabilsin)', async () => {
      const response = await request(http).get('/auth/me').expect(401);

      const body = response.body as { requestId?: string };
      expect(body.requestId).toBe(response.headers['x-request-id']);
    });

    // REGRESYON: AllExceptionsFilter mevcut hata gövdelerini YENİDEN
    // YAZMAMALI — apps/web `PLAN_LIMIT_EXCEEDED` kodunu ve `message`'ı
    // okuyor (lib/api.ts → parseErrorBody). Filtre gövdeyi normalize
    // etseydi "Pro'ya yükselt" CTA'sı sessizce kaybolurdu.
    it('PlanLimitExceededException’ın error kodu korunur', async () => {
      const owner = await registerUser(app);
      const org = await createOrg(prisma, { ownerId: owner.id });

      // FREE planda 1 board hakkı var (PLAN_LIMITS) — ikincisi reddedilmeli.
      const create = () =>
        request(http)
          .post(`/organizations/${org.id}/boards`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .send({ name: 'Board' });

      await create().expect(201);
      const rejected = await create().expect(403);

      const body = rejected.body as { error?: string; message?: string };
      expect(body.error).toBe('PLAN_LIMIT_EXCEEDED');
      expect(body.message).toEqual(expect.any(String));
    });

    it('validation hatalarının message dizisi korunur', async () => {
      const response = await request(http)
        .post('/auth/register')
        .send({ email: 'gecersiz', password: 'kisa', name: '' })
        .expect(400);

      const body = response.body as { message?: unknown };
      expect(Array.isArray(body.message)).toBe(true);
    });
  });
});
