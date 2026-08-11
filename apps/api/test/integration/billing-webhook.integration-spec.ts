import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac } from 'crypto';
import request from 'supertest';
import type { App } from 'supertest/types';
import { PrismaService } from '../../src/prisma/prisma.service';
import { createIntegrationApp, resetDatabase } from './integration-app';
import { addMember, createOrg, registerUser } from './fixtures';
import type { TestOrg, TestUser } from './fixtures';

// Faz 7.1 — billing webhook'u. billing.service.spec.ts (unit) StripeClient'ı
// mock'layıp "constructEvent ne dönerse ona göre davran"ı test ediyor;
// buradaki testler zincirin gerçek halkalarını kapatıyor:
//   - imza GERÇEKTEN ham gövde byte'ları üzerinden doğrulanıyor mu
//     (main.ts'teki `rawBody: true` — unit testlerin hiç görmediği bir
//     uygulama seçeneği; bozulursa prod'da gerçek Stripe imzaları reddedilir
//     ama tüm unit testler yeşil kalır),
//   - reddedilen bir webhook DB'ye gerçekten hiç dokunmuyor mu,
//   - kabul edilen bir webhook org'u + fatura satırını gerçekten yazıyor mu.

describe('Billing webhook (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: App;
  let webhookSecret: string;

  let org: TestOrg;

  beforeAll(async () => {
    ({ app, prisma } = await createIntegrationApp());
    http = app.getHttpServer() as App;
    // Uygulamanın GERÇEKTEN kullandığı secret — testin kendi sabitini
    // uydurması, .env/CI yapılandırması bozulduğunda bunu fark etmemek
    // demek olurdu.
    webhookSecret = app
      .get(ConfigService)
      .getOrThrow<string>('STRIPE_WEBHOOK_SECRET');
  });

  beforeEach(async () => {
    await resetDatabase(prisma);
    org = await createOrg(prisma);
  });

  afterAll(async () => {
    await app.close();
  });

  // Gerçek Stripe'ın `Stripe-Signature` header'ını ürettiği yol — mock
  // client'ın signWebhookPayload'ını ÇAĞIRMIYORUZ bilinçli olarak: test
  // "dışarıdan gelen" tarafı temsil etmeli, aksi halde imzalama ve doğrulama
  // aynı hatayı paylaşsa test yine yeşil kalırdı.
  function signature(
    rawBody: string,
    options: { secret?: string; timestampMs?: number } = {},
  ): string {
    const timestampMs = options.timestampMs ?? Date.now();
    const hex = createHmac('sha256', options.secret ?? webhookSecret)
      .update(`${timestampMs}.${rawBody}`)
      .digest('hex');
    return `t=${timestampMs},v1=${hex}`;
  }

  function checkoutCompletedBody(orgId: string): string {
    return JSON.stringify({
      id: 'evt_mock_test',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_mock_test',
          customer: 'cus_mock_test',
          subscription: 'sub_mock_test',
          metadata: { orgId },
        },
      },
    });
  }

  const postWebhook = (rawBody: string, sig?: string) => {
    const req = request(http)
      .post('/billing/webhook')
      .set('Content-Type', 'application/json');
    if (sig !== undefined) {
      req.set('Stripe-Signature', sig);
    }
    return req.send(rawBody);
  };

  describe('geçerli imza', () => {
    it('org’u PRO yapar, stripe id’lerini yazar ve bir fatura satırı açar', async () => {
      const rawBody = checkoutCompletedBody(org.id);

      const response = await postWebhook(rawBody, signature(rawBody)).expect(
        201,
      );
      expect(response.body).toEqual({ received: true });

      const updated = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(updated!.plan).toBe('PRO');
      expect(updated!.stripeCustomerId).toBe('cus_mock_test');
      expect(updated!.stripeSubscriptionId).toBe('sub_mock_test');

      const invoices = await prisma.invoice.findMany({
        where: { orgId: org.id },
      });
      expect(invoices).toHaveLength(1);
      expect(invoices[0].amountCents).toBe(2900);
      expect(invoices[0].currency).toBe('usd');
    });

    // İDEMPOTENCY — gerçek Stripe aynı event'i birden fazla kez teslim
    // edebilir (2xx dönene kadar retry eder, en-az-bir-kez garantisi). İşlenen
    // event id'leri `processed_webhook_events` tablosunda unique olarak
    // tutuluyor: tekrar teslim edilen bir event ikinci bir fatura satırı
    // AÇMIYOR ve yine 2xx dönüyor (Stripe retry'ı durdursun diye). Aynı
    // event.id, mock akışta imzalı link'ten türeyen sessionId'ye bağlı,
    // dolayısıyla saldırgan tarafından serbestçe seçilemiyor.
    it('aynı event iki kez teslim edilse de tek fatura satırı açılır (idempotent)', async () => {
      const rawBody = checkoutCompletedBody(org.id);

      await postWebhook(rawBody, signature(rawBody)).expect(201);
      await postWebhook(rawBody, signature(rawBody)).expect(201);

      expect(
        (await prisma.organization.findUnique({ where: { id: org.id } }))!.plan,
      ).toBe('PRO');
      expect(await prisma.invoice.count({ where: { orgId: org.id } })).toBe(1);
    });

    it('checkout.session.completed dışındaki bir event org’a dokunmaz', async () => {
      const rawBody = JSON.stringify({
        id: 'evt_other',
        type: 'customer.subscription.updated',
        data: { object: { id: 'sub_x', metadata: { orgId: org.id } } },
      });

      await postWebhook(rawBody, signature(rawBody)).expect(201);

      const unchanged = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(unchanged!.plan).toBe('FREE');
      expect(await prisma.invoice.count()).toBe(0);
    });
  });

  // 7.1'in en kritik testi. `rawBody: true` kaldırılsa (ya da ileride bir
  // body-parser değişikliği gövdeyi yeniden serialize etse) gövde
  // JSON.parse→JSON.stringify turundan geçer, boşluklar/anahtar sırası
  // değişir ve GERÇEK Stripe imzaları prod'da sessizce reddedilmeye başlar.
  // Aşağıdaki gövde bilinçli olarak "yeniden serialize edilirse farklı
  // olacak" bir biçimde yazıldı (fazladan boşluk + alfabetik olmayan anahtar
  // sırası).
  it('imzayı ham gövde byte’ları üzerinden doğrular (rawBody regresyonu)', async () => {
    const rawBody = `{ "type"  :  "checkout.session.completed",\n  "id": "evt_raw",\n  "data": { "object": { "subscription": "sub_raw", "id": "cs_raw", "metadata": { "orgId": "${org.id}" }, "customer": "cus_raw" } } }`;

    expect(rawBody).not.toBe(JSON.stringify(JSON.parse(rawBody))); // ön koşul

    await postWebhook(rawBody, signature(rawBody)).expect(201);

    expect(
      (await prisma.organization.findUnique({ where: { id: org.id } }))!.plan,
    ).toBe('PRO');
  });

  describe('reddedilen istekler DB’ye hiç dokunmaz', () => {
    async function expectOrgUntouched() {
      const untouched = await prisma.organization.findUnique({
        where: { id: org.id },
      });
      expect(untouched!.plan).toBe('FREE');
      expect(untouched!.stripeCustomerId).toBeNull();
      expect(await prisma.invoice.count()).toBe(0);
    }

    it('Stripe-Signature header’ı yoksa 401', async () => {
      await postWebhook(checkoutCompletedBody(org.id)).expect(401);
      await expectOrgUntouched();
    });

    it('imza formatı bozuksa 401', async () => {
      const rawBody = checkoutCompletedBody(org.id);
      await postWebhook(rawBody, 'bu-bir-imza-degil').expect(401);
      await expectOrgUntouched();
    });

    it('yanlış secret ile imzalanmışsa 401', async () => {
      const rawBody = checkoutCompletedBody(org.id);
      await postWebhook(
        rawBody,
        signature(rawBody, { secret: 'whsec_yanlis_secret' }),
      ).expect(401);
      await expectOrgUntouched();
    });

    // Saldırgan senaryosu: başka bir org için üretilmiş geçerli bir imzayı
    // alıp gövdedeki orgId'yi kendi org'uyla değiştirmek.
    it('gövde imzalandıktan sonra değiştirilmişse 401', async () => {
      const victim = await createOrg(prisma);
      const signedBody = checkoutCompletedBody(victim.id);
      const validSignature = signature(signedBody);

      const tamperedBody = signedBody.replace(victim.id, org.id);
      await postWebhook(tamperedBody, validSignature).expect(401);

      await expectOrgUntouched();
      expect(
        (await prisma.organization.findUnique({ where: { id: victim.id } }))!
          .plan,
      ).toBe('FREE');
    });

    it('5 dakikadan eski bir imza (replay) 401', async () => {
      const rawBody = checkoutCompletedBody(org.id);
      await postWebhook(
        rawBody,
        signature(rawBody, { timestampMs: Date.now() - 10 * 60 * 1000 }),
      ).expect(401);
      await expectOrgUntouched();
    });

    it('gelecekte (önceden imzalanıp saklanmış) bir timestamp 401', async () => {
      const rawBody = checkoutCompletedBody(org.id);
      await postWebhook(
        rawBody,
        signature(rawBody, { timestampMs: Date.now() + 10 * 60 * 1000 }),
      ).expect(401);
      await expectOrgUntouched();
    });
  });

  // Org-scoped billing uçlarının yetki sınırı — "Kurallar"daki "org-scoped
  // izolasyon her yeni endpoint'te kontrol edilir" maddesi.
  describe('org-scoped billing uçlarının yetkilendirmesi', () => {
    let owner: TestUser;
    let ownedOrg: TestOrg;

    const checkoutBody = {
      successUrl: 'http://localhost:3000/admin/x/billing?ok=1',
      cancelUrl: 'http://localhost:3000/admin/x/billing',
    };

    beforeEach(async () => {
      owner = await registerUser(app);
      ownedOrg = await createOrg(prisma, { ownerId: owner.id });
    });

    it('OWNER checkout session başlatabilir', async () => {
      const response = await request(http)
        .post(`/organizations/${ownedOrg.id}/billing/checkout-session`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send(checkoutBody)
        .expect(201);

      expect((response.body as { url: string }).url).toContain(
        '/billing/mock-checkout',
      );
    });

    it('auth’suz istek 401', async () => {
      await request(http)
        .post(`/organizations/${ownedOrg.id}/billing/checkout-session`)
        .send(checkoutBody)
        .expect(401);
    });

    it('MEMBER rolü checkout session başlatamaz (403)', async () => {
      const member = await registerUser(app);
      await addMember(prisma, ownedOrg.id, member.id, 'MEMBER');

      await request(http)
        .post(`/organizations/${ownedOrg.id}/billing/checkout-session`)
        .set('Authorization', `Bearer ${member.accessToken}`)
        .send(checkoutBody)
        .expect(403);
    });

    it('org üyesi olmayan biri fatura geçmişini göremez', async () => {
      const outsider = await registerUser(app);

      await request(http)
        .get(`/organizations/${ownedOrg.id}/billing`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .expect(403);
    });

    it('geçersiz successUrl 400 döner (ValidationPipe)', async () => {
      await request(http)
        .post(`/organizations/${ownedOrg.id}/billing/checkout-session`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({ successUrl: 'url-degil', cancelUrl: checkoutBody.cancelUrl })
        .expect(400);
    });

    // Açık yönlendirme koruması: geçerli bir http(s) URL ama BİZİM origin'imiz
    // değil (WEB_ORIGIN listesinde yok) — DTO'yu geçse de servis reddediyor.
    it('izin verilen origin dışındaki bir successUrl 400 döner (açık yönlendirme koruması)', async () => {
      await request(http)
        .post(`/organizations/${ownedOrg.id}/billing/checkout-session`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          successUrl: 'https://evil.example.com/ok',
          cancelUrl: checkoutBody.cancelUrl,
        })
        .expect(400);
    });
  });

  // Mock checkout sayfası auth'suz public bir GET — tek koruması URL'deki
  // HMAC. Bu testler o korumanın gerçekten devrede olduğunu gösteriyor.
  describe('mock checkout linki (public GET)', () => {
    it('imzası tahrif edilmiş bir link 401 döner', async () => {
      const owner = await registerUser(app);
      const ownedOrg = await createOrg(prisma, { ownerId: owner.id });

      const created = await request(http)
        .post(`/organizations/${ownedOrg.id}/billing/checkout-session`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          successUrl: 'http://localhost:3000/ok',
          cancelUrl: 'http://localhost:3000/cancel',
        })
        .expect(201);

      const url = (created.body as { url: string }).url;

      // Aynı link, sadece orgId başka bir org'unkiyle değiştirilmiş.
      const tampered = url.replace(ownedOrg.id, org.id);
      await request(http).get(tampered).expect(401);

      // Orijinal link ise çalışmalı (test'in gerçekten imzayı ölçtüğünün
      // kontrolü — link zaten bozuk olsaydı ilk assert anlamsız olurdu).
      await request(http).get(url).expect(200);
    });

    it('mock checkout HTML sayfası sıkı bir CSP header taşır (script yok)', async () => {
      const owner = await registerUser(app);
      const ownedOrg = await createOrg(prisma, { ownerId: owner.id });

      const created = await request(http)
        .post(`/organizations/${ownedOrg.id}/billing/checkout-session`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .send({
          successUrl: 'http://localhost:3000/ok',
          cancelUrl: 'http://localhost:3000/cancel',
        })
        .expect(201);
      const url = (created.body as { url: string }).url;

      const page = await request(http).get(url).expect(200);
      const csp = page.headers['content-security-policy'];
      // Global helmet CSP kapalı olsa da bu HTML ucu kendi sıkı CSP'sini
      // taşımalı: default-src 'none' scripti bloke eder, inline style'a izin.
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("style-src 'unsafe-inline'");
    });
  });
});
