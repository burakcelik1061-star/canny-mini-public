// Faz 6.1 — Stripe hesabı YOK ve Faz 7.5'e
// kadar açılmayacak. `EmailProvider` (Faz 5.2) ile aynı soyutlama deseni:
// bugün tek implementasyon `MockStripeClient`, ileride gerçek `stripe` npm
// paketiyle konuşan bir `RealStripeClient` eklemek `BillingModule`'deki tek
// bir `useClass` satırını değiştirmek olacak — `BillingService` hiç
// dokunulmayacak. Metod imzaları bilinçli olarak gerçek Stripe Node SDK'sının
// (`stripe.checkout.sessions.create` / `stripe.webhooks.constructEvent`)
// alanlarının bir alt kümesi — geçişi kolaylaştırmak için.
export interface CheckoutSessionParams {
  orgId: string;
  // Gerçek Stripe Checkout Session'ında `customer_email`/`client_reference_id`
  // ayrı alanlardır; burada tek bir `orgId` yeterli çünkü tek başına ödeme
  // yapan bireysel bir müşteri değil, "org'u PRO'ya geçir" senaryosu var.
  successUrl: string;
  cancelUrl: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

// Faz 6.3 — gerçek Stripe SDK'sındaki `stripe.billingPortal.sessions.create`
// karşılığı. Customer Portal, Stripe'ın kart güncelleme/abonelik iptal
// akışını barındırdığı KENDİ hosted sayfası — biz de aynı şekilde bunu
// bizim backend'imizin kendi hosted bir sayfası olarak taklit ediyoruz
// (bkz. BillingController.mockPortalPage, createCheckoutSession'la aynı
// desen).
export interface PortalSessionParams {
  orgId: string;
  returnUrl: string;
}

export interface PortalSession {
  url: string;
}

// Gerçek Stripe event'lerinin çok küçük bir alt kümesi — sadece 6.1'in
// ihtiyacı olan `checkout.session.completed`. Yeni bir event tipi
// gerektiğinde (ör. `customer.subscription.deleted`, Faz 6.2/6.3) burada
// genişletilecek.
export interface StripeCheckoutCompletedEvent {
  id: string;
  type: 'checkout.session.completed';
  data: {
    object: {
      id: string;
      customer: string;
      subscription: string;
      metadata: { orgId: string };
    };
  };
}

export type StripeEvent = StripeCheckoutCompletedEvent;

export interface StripeClient {
  createCheckoutSession(
    params: CheckoutSessionParams,
  ): Promise<CheckoutSession>;

  createPortalSession(params: PortalSessionParams): Promise<PortalSession>;

  // Gerçek Stripe SDK'sı burada `(rawBody: string | Buffer, signature: string,
  // webhookSecret: string) => Event` imzasını kullanır (webhookSecret çağıran
  // taraf — bizim `BillingService`'imiz — tarafından env'den okunup verilir).
  // Doğrulama başarısızsa (imza uyuşmuyor/süresi geçmiş) fırlatır.
  constructEvent(rawBody: string, signature: string): StripeEvent;
}

// DI token — EMAIL_PROVIDER ile aynı gerekçe (interface'ler runtime'da yok).
export const STRIPE_CLIENT = 'STRIPE_CLIENT';
