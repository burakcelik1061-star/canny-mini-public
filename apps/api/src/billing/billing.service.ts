import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Invoice, Organization, Plan, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreatePortalSessionDto } from './dto/create-portal-session.dto';
import {
  MockCheckoutLinkPayload,
  MockPortalLinkPayload,
  MockStripeClient,
} from './mock-stripe.client';
import type {
  CheckoutSession,
  PortalSession,
  StripeClient,
} from './stripe-client.interface';
import { STRIPE_CLIENT } from './stripe-client.interface';

// Faz 6.3 — mock akış tek bir sabit fiyatlı Pro plan varsayıyor (0.1
// dokümanında ayrı fiyatlandırma kademeleri yok). Gerçek Stripe'ta bu bir
// `Price` objesinin `unit_amount`'ı olurdu.
const PRO_PLAN_PRICE_CENTS = 2900; // $29.00/ay
const PRO_PLAN_CURRENCY = 'usd';

const DEFAULT_ALLOWED_ORIGINS =
  'http://localhost:3000,http://localhost:5173,http://localhost:5174';

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STRIPE_CLIENT) private readonly stripeClient: StripeClient,
  ) {}

  async createCheckoutSession(
    orgId: string,
    dto: CreateCheckoutSessionDto,
  ): Promise<CheckoutSession> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException('Organizasyon bulunamadı');
    }

    // successUrl/cancelUrl DTO'da "geçerli http(s) URL" olarak doğrulanıyor
    // ama bunlar imzalı link'e gömülüp sonra 302 ile YÖNLENDİRİLİYOR — açık
    // yönlendirmeyi (API origin'inde barınan, saldırgan sayfasına götüren bir
    // link) önlemek için origin'i izin listesine karşı da doğruluyoruz.
    this.assertAllowedRedirect(dto.successUrl);
    this.assertAllowedRedirect(dto.cancelUrl);

    // Zaten PRO olan bir org'un tekrar checkout başlatmasını bilinçli
    // olarak engellemiyoruz (curl/Postman'la test etmeyi zorlaştırırdı,
    // gerçek Stripe da bunu sunucu tarafında engellemez) — Faz 6.3'teki
    // billing sayfası zaten PRO org'a bu butonu hiç göstermeyecek.
    return this.stripeClient.createCheckoutSession({
      orgId,
      successUrl: dto.successUrl,
      cancelUrl: dto.cancelUrl,
    });
  }

  // Gerçek Stripe webhook'unun ta kendisi — BillingController'daki HEM
  // `POST /billing/webhook` (mock "Stripe sunucusu"nun çağırdığı gerçek uç)
  // HEM DE mock checkout onay adımı (BillingController.confirmMockCheckout,
  // gerçek bir Stripe entegrasyonundaki gibi kendi sunucusuna HTTP çağrısı
  // yapıyor, bkz. o metodun yorumu) burayı çağırır — imza doğrulama kodu
  // her iki yolda da AYNI, sahte olan sadece "kim çağırıyor".
  async handleWebhookEvent(rawBody: string, signature: string): Promise<void> {
    const event = this.stripeClient.constructEvent(rawBody, signature);

    if (event.type !== 'checkout.session.completed') {
      // Bilinçli olarak başka event tipi kabul edilmiyor (Faz 6.1 kapsamı
      // sadece "ödeme tamamlandı" akışı).
      return;
    }

    const { orgId } = event.data.object.metadata;
    try {
      // İdempotency: aynı transaction içinde ÖNCE işlenen-event kaydını
      // açıyoruz. Gerçek Stripe aynı event'i tekrar teslim edebilir
      // (en-az-bir-kez); ikinci teslimde processedWebhookEvent.create
      // unique (`eventId`) kısıtına P2002 ile çarpar, transaction geri sarılır
      // ve aşağıda sessiz bir no-op olarak ele alınır — böylece tekrar teslim
      // İKİNCİ bir Invoice satırı AÇMAZ. org'u PRO yapmak + Invoice satırı
      // hepsi aynı atomik işlemde (bkz. schema.prisma → ProcessedWebhookEvent).
      await this.prisma.$transaction(async (tx) => {
        await tx.processedWebhookEvent.create({
          data: { eventId: event.id },
        });
        await tx.organization.update({
          where: { id: orgId },
          data: {
            plan: Plan.PRO,
            stripeCustomerId: event.data.object.customer,
            stripeSubscriptionId: event.data.object.subscription,
          },
        });
        await tx.invoice.create({
          data: {
            orgId,
            amountCents: PRO_PLAN_PRICE_CENTS,
            currency: PRO_PLAN_CURRENCY,
            description: 'Pro plan — aylık abonelik',
            stripeInvoiceId: `in_mock_${randomBytes(8).toString('hex')}`,
          },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        // Zaten işlenmiş bir event tekrar teslim edildi — idempotent no-op.
        return;
      }
      throw error;
    }
  }

  // Faz 6.3 — billing sayfasının tek yükleme çağrısı: mevcut plan + fatura
  // geçmişi (en yeni önce).
  async getBillingOverview(
    orgId: string,
  ): Promise<{ plan: Plan; invoices: Invoice[] }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true },
    });
    if (!org) {
      throw new NotFoundException('Organizasyon bulunamadı');
    }
    const invoices = await this.prisma.invoice.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return { plan: org.plan, invoices };
  }

  async createPortalSession(
    orgId: string,
    dto: CreatePortalSessionDto,
  ): Promise<PortalSession> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) {
      throw new NotFoundException('Organizasyon bulunamadı');
    }
    this.assertAllowedRedirect(dto.returnUrl);
    return this.stripeClient.createPortalSession({
      orgId,
      returnUrl: dto.returnUrl,
    });
  }

  // Gerçek Stripe Customer Portal'ında "İptal et" tıklanınca Stripe kendi
  // sunucusunda aboneliği iptal edip bir `customer.subscription.deleted`
  // webhook'u gönderir; mock akışımızda bu senkron bir çağrı — ayrı bir
  // webhook round-trip'i simüle etmek (BillingController.mockPortalPage'in
  // zaten kendi backend'imiz olduğu bir sayfada) ekstra karmaşıklık,
  // gerçek bir fayda katmıyordu. `stripeSubscriptionId` temizlenir,
  // `stripeCustomerId` KALIR (gerçek Stripe'ta da müşteri kaydı silinmez,
  // sadece abonelik) — fatura geçmişi de kalıcı, silinmiyor.
  async cancelSubscription(orgId: string): Promise<Organization> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) {
      throw new NotFoundException('Organizasyon bulunamadı');
    }
    return this.prisma.organization.update({
      where: { id: orgId },
      data: { plan: Plan.FREE, stripeSubscriptionId: null },
    });
  }

  // BillingController.mockCheckoutPage/confirmMockCheckout tarafından
  // kullanılıyor — MockStripeClient somut sınıfına özgü link
  // imzalama/doğrulama metodlarına erişim (StripeClient arayüzünün DIŞINDA,
  // gerçek Stripe'ta karşılığı olmayan, sadece bizim mock sayfamıza özgü bir
  // ayrıntı — bu yüzden arayüze eklenmedi).
  // Yönlendirme URL'inin origin'i izin verilen listede mi? Liste app-setup.ts'
  // teki CORS ile AYNI kaynaktan (WEB_ORIGIN) okunuyor — apps/web/apps/widget
  // origin'leri. DTO zaten "geçerli http(s) URL" doğruluyor; buradaki kontrol
  // "bizim origin'imiz mi" sorusunu ekliyor (açık yönlendirme koruması).
  private assertAllowedRedirect(rawUrl: string): void {
    const allowed = (process.env.WEB_ORIGIN ?? DEFAULT_ALLOWED_ORIGINS)
      .split(',')
      .map((origin) => origin.trim());
    let origin: string;
    try {
      origin = new URL(rawUrl).origin;
    } catch {
      throw new BadRequestException('Geçersiz yönlendirme URL’i');
    }
    if (!allowed.includes(origin)) {
      throw new BadRequestException(
        'Yönlendirme URL’i izin verilen origin listesinde değil',
      );
    }
  }

  getMockClient(): MockStripeClient {
    if (!(this.stripeClient instanceof MockStripeClient)) {
      throw new Error(
        'Mock checkout uçları sadece MockStripeClient ile çalışır',
      );
    }
    return this.stripeClient;
  }
}

export type { MockCheckoutLinkPayload, MockPortalLinkPayload };
