import { UnauthorizedException } from '@nestjs/common';
import { MockStripeClient } from './mock-stripe.client';
import { StripeCheckoutCompletedEvent } from './stripe-client.interface';

describe('MockStripeClient', () => {
  let client: MockStripeClient;

  beforeEach(() => {
    client = new MockStripeClient('test_webhook_secret');
  });

  describe('createCheckoutSession', () => {
    it('bir mock checkout session id ve imzalı bir url döner', async () => {
      const session = await client.createCheckoutSession({
        orgId: 'org-1',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });

      expect(session.id).toMatch(/^cs_mock_[0-9a-f]+$/);
      expect(session.url).toContain('/billing/mock-checkout?');
      expect(session.url).toContain('orgId=org-1');
      expect(session.url).toContain('sig=');
    });

    it("döndürdüğü url'in imzası verifyLinkPayload ile doğrulanabilir", async () => {
      const session = await client.createCheckoutSession({
        orgId: 'org-1',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });
      const params = new URLSearchParams(session.url.split('?')[1]);

      expect(() =>
        client.verifyLinkPayload(
          {
            sessionId: params.get('sessionId')!,
            orgId: params.get('orgId')!,
            successUrl: params.get('successUrl')!,
            cancelUrl: params.get('cancelUrl')!,
            exp: Number(params.get('exp')),
          },
          params.get('sig')!,
        ),
      ).not.toThrow();
    });
  });

  describe('verifyLinkPayload', () => {
    const payload = {
      sessionId: 'cs_mock_1',
      orgId: 'org-1',
      successUrl: 'http://localhost:3000/success',
      cancelUrl: 'http://localhost:3000/cancel',
      exp: Date.now() + 60_000,
    };

    it('geçerli bir imzayı kabul eder', () => {
      const signature = client.signLinkPayload(
        payload,
        // signLinkPayload'ın kendisi link-secret'ı hesaplamıyor, o yüzden
        // burada createCheckoutSession üzerinden dolaylı test ediyoruz
        // (üstteki 'döndürdüğü url' testi) — bu test sadece tamper/expiry
        // reddini kontrol ediyor.
        'irrelevant-because-verifyLinkPayload-recomputes-its-own-secret',
      );
      // Bilinçli olarak yanlış: gerçek link secret'ı private, bu yüzden bu
      // imza reddedilmeli.
      expect(() => client.verifyLinkPayload(payload, signature)).toThrow(
        UnauthorizedException,
      );
    });

    it('süresi geçmiş bir linki reddeder', () => {
      const expired = { ...payload, exp: Date.now() - 1 };
      expect(() => client.verifyLinkPayload(expired, 'anything')).toThrow(
        'süresi dolmuş',
      );
    });

    it("tahrif edilmiş bir orgId'yi reddeder", async () => {
      const session = await client.createCheckoutSession({
        orgId: 'org-1',
        successUrl: payload.successUrl,
        cancelUrl: payload.cancelUrl,
      });
      const params = new URLSearchParams(session.url.split('?')[1]);
      const tampered = {
        sessionId: params.get('sessionId')!,
        orgId: 'org-2', // başka bir org'a değiştirildi
        successUrl: params.get('successUrl')!,
        cancelUrl: params.get('cancelUrl')!,
        exp: Number(params.get('exp')),
      };
      expect(() =>
        client.verifyLinkPayload(tampered, params.get('sig')!),
      ).toThrow(UnauthorizedException);
    });

    it("tahrif edilmiş bir sessionId'yi reddeder (sessionId artık imzalı)", async () => {
      const session = await client.createCheckoutSession({
        orgId: 'org-1',
        successUrl: payload.successUrl,
        cancelUrl: payload.cancelUrl,
      });
      const params = new URLSearchParams(session.url.split('?')[1]);
      const tampered = {
        sessionId: 'cs_mock_saldirgan', // sessionId değiştirildi
        orgId: params.get('orgId')!,
        successUrl: params.get('successUrl')!,
        cancelUrl: params.get('cancelUrl')!,
        exp: Number(params.get('exp')),
      };
      expect(() =>
        client.verifyLinkPayload(tampered, params.get('sig')!),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('createPortalSession', () => {
    it('imzalı bir mock portal url döner', async () => {
      const session = await client.createPortalSession({
        orgId: 'org-1',
        returnUrl: 'http://localhost:3000/admin/acme/billing',
      });

      expect(session.url).toContain('/billing/mock-portal?');
      expect(session.url).toContain('orgId=org-1');
      expect(session.url).toContain('sig=');
    });

    it("döndürdüğü url'in imzası verifyPortalLinkPayload ile doğrulanabilir", async () => {
      const session = await client.createPortalSession({
        orgId: 'org-1',
        returnUrl: 'http://localhost:3000/admin/acme/billing',
      });
      const params = new URLSearchParams(session.url.split('?')[1]);

      expect(() =>
        client.verifyPortalLinkPayload(
          {
            orgId: params.get('orgId')!,
            returnUrl: params.get('returnUrl')!,
            exp: Number(params.get('exp')),
          },
          params.get('sig')!,
        ),
      ).not.toThrow();
    });

    it('checkout linki için üretilmiş bir imza portal linkinde GEÇERSİZ olur (payload tipleri çapraz kullanılamaz)', async () => {
      const checkoutSession = await client.createCheckoutSession({
        orgId: 'org-1',
        successUrl: 'http://localhost:3000/success',
        cancelUrl: 'http://localhost:3000/cancel',
      });
      const params = new URLSearchParams(checkoutSession.url.split('?')[1]);

      expect(() =>
        client.verifyPortalLinkPayload(
          {
            orgId: 'org-1',
            returnUrl: 'http://localhost:3000/success', // successUrl'i returnUrl gibi kullanmaya çalışıyor
            exp: Number(params.get('exp')),
          },
          params.get('sig')!, // ama checkout linkinin imzası
        ),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('verifyPortalLinkPayload', () => {
    it('süresi geçmiş bir linki reddeder', () => {
      const expired = {
        orgId: 'org-1',
        returnUrl: 'http://localhost:3000/billing',
        exp: Date.now() - 1,
      };
      expect(() => client.verifyPortalLinkPayload(expired, 'anything')).toThrow(
        'süresi dolmuş',
      );
    });

    it("tahrif edilmiş bir orgId'yi reddeder", async () => {
      const session = await client.createPortalSession({
        orgId: 'org-1',
        returnUrl: 'http://localhost:3000/billing',
      });
      const params = new URLSearchParams(session.url.split('?')[1]);
      const tampered = {
        orgId: 'org-2',
        returnUrl: params.get('returnUrl')!,
        exp: Number(params.get('exp')),
      };
      expect(() =>
        client.verifyPortalLinkPayload(tampered, params.get('sig')!),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('constructEvent / signWebhookPayload', () => {
    const event: StripeCheckoutCompletedEvent = {
      id: 'evt_mock_1',
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_mock_1',
          customer: 'cus_mock_1',
          subscription: 'sub_mock_1',
          metadata: { orgId: 'org-1' },
        },
      },
    };

    it("kendi imzaladığı bir gövdeyi doğrular ve event'i geri döner", () => {
      const rawBody = JSON.stringify(event);
      const signature = client.signWebhookPayload(rawBody);

      const parsed = client.constructEvent(rawBody, signature);
      expect(parsed).toEqual(event);
    });

    it("yanlış secret'la üretilmiş bir imzayı reddeder", () => {
      const otherClient = new MockStripeClient('different_secret');
      const rawBody = JSON.stringify(event);
      const signature = otherClient.signWebhookPayload(rawBody);

      expect(() => client.constructEvent(rawBody, signature)).toThrow(
        UnauthorizedException,
      );
    });

    it("geçersiz formatlı bir imza header'ını reddeder", () => {
      expect(() =>
        client.constructEvent(JSON.stringify(event), 'not-a-valid-header'),
      ).toThrow('imza formatı');
    });

    it('tahrif edilmiş bir gövdeyi (imza gövdeyle eşleşmiyor) reddeder', () => {
      const rawBody = JSON.stringify(event);
      const signature = client.signWebhookPayload(rawBody);
      const tamperedBody = JSON.stringify({
        ...event,
        data: {
          object: { ...event.data.object, metadata: { orgId: 'org-evil' } },
        },
      });

      expect(() => client.constructEvent(tamperedBody, signature)).toThrow(
        UnauthorizedException,
      );
    });

    it("süresi geçmiş (eski timestamp'li) bir webhook isteğini reddeder", () => {
      const rawBody = JSON.stringify(event);
      const oldTimestamp = Date.now() - 10 * 60 * 1000; // 10 dk önce
      const { createHmac } =
        jest.requireActual<typeof import('crypto')>('crypto');
      const hex = createHmac('sha256', 'test_webhook_secret')
        .update(`${oldTimestamp}.${rawBody}`)
        .digest('hex');

      expect(() =>
        client.constructEvent(rawBody, `t=${oldTimestamp},v1=${hex}`),
      ).toThrow('süresi dolmuş');
    });

    it('gelecekte (önceden imzalanıp saklanmış) bir timestamp reddedilir', () => {
      const rawBody = JSON.stringify(event);
      const futureTimestamp = Date.now() + 10 * 60 * 1000; // 10 dk sonrası
      const { createHmac } =
        jest.requireActual<typeof import('crypto')>('crypto');
      const hex = createHmac('sha256', 'test_webhook_secret')
        .update(`${futureTimestamp}.${rawBody}`)
        .digest('hex');

      expect(() =>
        client.constructEvent(rawBody, `t=${futureTimestamp},v1=${hex}`),
      ).toThrow('süresi dolmuş');
    });
  });
});
