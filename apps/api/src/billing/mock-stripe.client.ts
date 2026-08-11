import { Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import {
  CheckoutSession,
  CheckoutSessionParams,
  PortalSession,
  PortalSessionParams,
  STRIPE_CLIENT,
  StripeClient,
  StripeEvent,
} from './stripe-client.interface';

// İmza tolerans penceresi — AuthService.identifyWidgetUser'daki
// WIDGET_IDENTIFY_MAX_SKEW_MS ile aynı gerekçe (eski/tekrar oynatılmış bir
// webhook isteğini reddet), gerçek Stripe de aynı `t=` toleransını uyguluyor
// (varsayılan 5 dk).
const WEBHOOK_TOLERANCE_MS = 5 * 60 * 1000;

// Gelecek yönlü küçük bir saat kayması toleransı. Gerçek Stripe yalnızca
// "çok eski" damgaları reddeder; biz ayrıca "gelecekte" bir damgayı da (saat
// kaymasının makul sınırı dışında) reddediyoruz — aksi halde saldırgan
// şimdiden imzalayıp sonra oynatacağı bir istek üretebilir, yani kabul
// penceresi efektif olarak iki katına çıkardı.
const WEBHOOK_FUTURE_SKEW_MS = 30 * 1000;

// checkout-session URL'sindeki orgId/plan'ın (auth gerektirmeyen, herkese
// açık bir GET olan mock checkout sayfasında) tahmin edilerek/değiştirilerek
// başka bir org'u "PRO"ya geçirmeye çalışılamayacağını garanti eden ayrı bir
// HMAC — webhook imzasıyla AYNI secret'ı KULLANMIYOR, ikisi farklı
// güven sınırları (biri tarayıcıdan görünen bir URL, diğeri sunucudan
// sunucuya bir çağrı).
export interface MockCheckoutLinkPayload {
  // sessionId imzaya DAHİL: aksi halde geçerli bir link'te sessionId serbestçe
  // değiştirilebiliyordu ve confirmMockCheckout onu event.id /
  // stripeSubscriptionId'e taşıyordu — yani "imzalı" bir capability'nin bir
  // parçası imzasızdı. Artık sessionId da imzalı, dolayısıyla event.id de.
  sessionId: string;
  orgId: string;
  successUrl: string;
  cancelUrl: string;
  exp: number;
}

// Faz 6.3 — createPortalSession'ın ürettiği `/billing/mock-portal` linki
// için aynı gerekçeyle (auth'suz public bir GET) ayrı bir HMAC korumalı
// payload.
export interface MockPortalLinkPayload {
  orgId: string;
  returnUrl: string;
  exp: number;
}

// Faz 6.1 — gerçek bir Stripe hesabı/API key'i olmadan "checkout & webhook" akışını uçtan uca gerçekten
// çalıştırılabilir kılan sahte istemci. Gerçek Stripe Checkout'un yaptığı
// işi iki parçaya ayırıyoruz:
//   1. createCheckoutSession — gerçek Stripe'ın hosted checkout sayfası
//      yerine kendi `/billing/mock-checkout` sayfamıza (BillingController)
//      giden, sahte olduğu her yerinde açıkça belli bir URL üretir.
//   2. constructEvent — o mock sayfada "ödemeyi tamamla" denince
//      BillingController'ın gerçek Stripe formatına (`t=...,v1=...`)
//      SAHİP bir imza ile POST /billing/webhook'a yaptığı çağrıyı doğrular.
// Yani webhook doğrulama kodu (BillingService.handleWebhookEvent) gerçek
// Stripe entegrasyonuyla birebir aynı yolu izliyor — sahte olan sadece
// "ödemeyi kim tetikliyor" (gerçek Stripe sunucusu yerine bizim mock sayfamız).
@Injectable()
export class MockStripeClient implements StripeClient {
  constructor(private readonly webhookSecret: string) {}

  createCheckoutSession(
    params: CheckoutSessionParams,
  ): Promise<CheckoutSession> {
    const id = `cs_mock_${randomBytes(12).toString('hex')}`;
    const linkSecret = this.linkSigningSecret();
    const payload: MockCheckoutLinkPayload = {
      sessionId: id,
      orgId: params.orgId,
      successUrl: params.successUrl,
      cancelUrl: params.cancelUrl,
      exp: Date.now() + WEBHOOK_TOLERANCE_MS,
    };
    const signature = this.signLinkPayload(payload, linkSecret);

    const query = new URLSearchParams({
      sessionId: payload.sessionId,
      orgId: payload.orgId,
      successUrl: payload.successUrl,
      cancelUrl: payload.cancelUrl,
      exp: String(payload.exp),
      sig: signature,
    });

    return Promise.resolve({
      id,
      url: `/billing/mock-checkout?${query.toString()}`,
    });
  }

  // Faz 6.3 — createCheckoutSession'ın portal karşılığı: gerçek Stripe'ın
  // hosted Customer Portal'ı yerine kendi `/billing/mock-portal` sayfamıza
  // giden, imzalı bir URL.
  createPortalSession(params: PortalSessionParams): Promise<PortalSession> {
    const linkSecret = this.linkSigningSecret();
    const payload: MockPortalLinkPayload = {
      orgId: params.orgId,
      returnUrl: params.returnUrl,
      exp: Date.now() + WEBHOOK_TOLERANCE_MS,
    };
    const signature = this.signPortalLinkPayload(payload, linkSecret);

    const query = new URLSearchParams({
      orgId: payload.orgId,
      returnUrl: payload.returnUrl,
      exp: String(payload.exp),
      sig: signature,
    });

    return Promise.resolve({ url: `/billing/mock-portal?${query.toString()}` });
  }

  // Gerçek Stripe SDK'sında karşılığı yok — orada bu imzayı Stripe'ın
  // SUNUCULARI üretir, biz asla üretmeyiz. Burada var çünkü mock akışında
  // "Stripe'ın sunucusu" rolünü de BİZ oynuyoruz (bkz.
  // BillingController.confirmMockCheckout) — `constructEvent`'in tam
  // simetriği, aynı formatı (`t=...,v1=...`) üretir ki doğrulama tarafı
  // gerçek koddan hiç ayrılmasın.
  signWebhookPayload(rawBody: string): string {
    const timestampMs = Date.now();
    const hex = createHmac('sha256', this.webhookSecret)
      .update(`${timestampMs}.${rawBody}`)
      .digest('hex');
    return `t=${timestampMs},v1=${hex}`;
  }

  constructEvent(rawBody: string, signature: string): StripeEvent {
    const match = /^t=(\d+),v1=([0-9a-f]+)$/.exec(signature);
    if (!match) {
      throw new UnauthorizedException('Geçersiz webhook imza formatı');
    }
    const [, timestampStr, providedHex] = match;
    const timestamp = Number(timestampStr);

    const age = Date.now() - timestamp;
    // Çok eski (replay) VEYA anlamlı ölçüde gelecekte (önceden imzalanıp
    // saklanmış) bir damgayı reddet.
    if (age > WEBHOOK_TOLERANCE_MS || age < -WEBHOOK_FUTURE_SKEW_MS) {
      throw new UnauthorizedException('Webhook isteğinin süresi dolmuş');
    }

    const expectedHex = createHmac('sha256', this.webhookSecret)
      .update(`${timestampStr}.${rawBody}`)
      .digest('hex');

    if (!this.hexStringsMatch(providedHex, expectedHex)) {
      throw new UnauthorizedException('Geçersiz webhook imzası');
    }

    return JSON.parse(rawBody) as StripeEvent;
  }

  // /billing/mock-checkout linkinin `sig` query param'ını üretir/doğrular —
  // BillingController hem createCheckoutSession'ın döndürdüğü URL'i
  // üretirken hem de o sayfaya gerçek bir GET geldiğinde doğrularken bunu
  // kullanır (bkz. billing.controller.ts).
  // Mesaj kanonik: alanlar ham `:` ile değil JSON dizisi olarak birleştiriliyor
  // (URL'ler `:` içerdiği için ham birleştirmede alan sınırları belirsizdi —
  // bir alanın sonu diğerinin başıyla karışabilirdi). Bir `checkout:v1` öneki
  // de portal imzasıyla çapraz kullanımı imkânsız kılıyor.
  signLinkPayload(payload: MockCheckoutLinkPayload, secret: string): string {
    const message =
      'checkout:v1:' +
      JSON.stringify([
        payload.sessionId,
        payload.orgId,
        payload.successUrl,
        payload.cancelUrl,
        payload.exp,
      ]);
    return createHmac('sha256', secret).update(message).digest('hex');
  }

  verifyLinkPayload(payload: MockCheckoutLinkPayload, signature: string) {
    if (Date.now() > payload.exp) {
      throw new UnauthorizedException('Bu checkout linkinin süresi dolmuş');
    }
    const expected = this.signLinkPayload(payload, this.linkSigningSecret());
    if (!this.hexStringsMatch(signature, expected)) {
      throw new UnauthorizedException('Geçersiz checkout linki');
    }
  }

  // signLinkPayload/verifyLinkPayload'ın portal linki için ikizi — aynı
  // `linkSigningSecret`'ı paylaşıyor (ikisi de "auth'suz public bir GET
  // sayfasının query param'larını tahrif edilmekten koru" amacıyla var,
  // farklı güven sınırları değiller — webhook imzasından FARKLI olarak),
  // sadece imzalanan alanlar farklı (mesaja hangi payload tipinin
  // imzalandığını belirten bir önek eklenir, checkout linkiyle çapraz
  // kullanılamasın diye).
  signPortalLinkPayload(
    payload: MockPortalLinkPayload,
    secret: string,
  ): string {
    const message =
      'portal:v1:' +
      JSON.stringify([payload.orgId, payload.returnUrl, payload.exp]);
    return createHmac('sha256', secret).update(message).digest('hex');
  }

  verifyPortalLinkPayload(payload: MockPortalLinkPayload, signature: string) {
    if (Date.now() > payload.exp) {
      throw new UnauthorizedException('Bu portal linkinin süresi dolmuş');
    }
    const expected = this.signPortalLinkPayload(
      payload,
      this.linkSigningSecret(),
    );
    if (!this.hexStringsMatch(signature, expected)) {
      throw new UnauthorizedException('Geçersiz portal linki');
    }
  }

  // Webhook secret'ından türetilmiş AYRI bir anahtar — aynı secret'ı iki
  // farklı amaç için (webhook gövdesi imzalama + link imzalama) birebir
  // kullanmamak için basit bir domain separation (bkz. yukarıdaki yorum).
  private linkSigningSecret(): string {
    return createHmac('sha256', this.webhookSecret)
      .update('mock-checkout-link')
      .digest('hex');
  }

  // AuthService.hexStringsMatch ile aynı sabit-zamanlı karşılaştırma deseni.
  private hexStringsMatch(a: string, b: string): boolean {
    try {
      const bufA = Buffer.from(a, 'hex');
      const bufB = Buffer.from(b, 'hex');
      return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
    } catch {
      return false;
    }
  }
}

export { STRIPE_CLIENT };
