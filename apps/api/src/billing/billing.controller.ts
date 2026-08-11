import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request, Response } from 'express';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreatePortalSessionDto } from './dto/create-portal-session.dto';
import {
  MockCheckoutLinkPayload,
  MockPortalLinkPayload,
} from './mock-stripe.client';
import { StripeCheckoutCompletedEvent } from './stripe-client.interface';

@Controller()
export class BillingController {
  constructor(
    private readonly billingService: BillingService,
    private readonly prisma: PrismaService,
  ) {}

  // Org-scoped: OrgMembershipGuard, invitations/widget-settings'le aynı
  // izolasyon (checkout başlatmak faturalandırmayı etkiliyor, sadece
  // OWNER|ADMIN).
  @UseGuards(JwtAccessGuard, OrgMembershipGuard)
  @OrgRoles('OWNER', 'ADMIN')
  @Post('organizations/:orgId/billing/checkout-session')
  async createCheckoutSession(
    @Param('orgId') orgId: string,
    @Body() dto: CreateCheckoutSessionDto,
  ) {
    return this.billingService.createCheckoutSession(orgId, dto);
  }

  // Faz 6.3 — billing sayfasının tek yükleme çağrısı (plan + fatura
  // geçmişi). Aynı izolasyon deseni: OWNER|ADMIN, çünkü fatura bilgisi
  // hassas.
  @UseGuards(JwtAccessGuard, OrgMembershipGuard)
  @OrgRoles('OWNER', 'ADMIN')
  @Get('organizations/:orgId/billing')
  async getBillingOverview(@Param('orgId') orgId: string) {
    return this.billingService.getBillingOverview(orgId);
  }

  // createCheckoutSession'ın Customer Portal karşılığı — aynı izolasyon,
  // aynı gerekçe.
  @UseGuards(JwtAccessGuard, OrgMembershipGuard)
  @OrgRoles('OWNER', 'ADMIN')
  @Post('organizations/:orgId/billing/portal-session')
  async createPortalSession(
    @Param('orgId') orgId: string,
    @Body() dto: CreatePortalSessionDto,
  ) {
    return this.billingService.createPortalSession(orgId, dto);
  }

  // Gerçek Stripe'ta bu sayfa checkout.stripe.com'da barınır ve bizim
  // backend'imizin hiç haberi olmaz — burada AUTH GEREKTİRMİYOR (tıpkı
  // gerçek Stripe Checkout'un da bizim JWT'mizi bilmemesi gibi), tek
  // koruması URL'deki HMAC imzası (bkz. MockStripeClient.verifyLinkPayload —
  // sadece BillingService.createCheckoutSession'ın ürettiği bir link
  // gerçek).
  @Get('billing/mock-checkout')
  @Header('Content-Type', 'text/html; charset=utf-8')
  // Global helmet CSP'si kapalı (JSON API; app-setup.ts) — ama bu HTML
  // sayfaları için sayfaya özel, sıkı bir CSP koyuyoruz: hiç script yok,
  // sadece inline style'a izin var (sayfa <style> kullanıyor), form yalnız
  // kendi origin'imize gidebilir. Escape başarısız olsa bile enjekte edilen
  // bir <script> çalışmaz.
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  )
  async mockCheckoutPage(
    @Query('sessionId') sessionId: string,
    @Query('orgId') orgId: string,
    @Query('successUrl') successUrl: string,
    @Query('cancelUrl') cancelUrl: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
  ) {
    const payload = this.parseLinkPayload(
      sessionId,
      orgId,
      successUrl,
      cancelUrl,
      exp,
    );
    this.billingService.getMockClient().verifyLinkPayload(payload, sig);

    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { name: true },
    });
    if (!org) {
      throw new BadRequestException('Organizasyon bulunamadı');
    }

    // Gerçek Stripe hosted checkout sayfasının en minimal karşılığı — kart
    // formu yok (mock'ta ödeme bilgisi toplamıyoruz), sadece "ödemeyi
    // tamamla" onayı. Tek satırlık inline form: ayrı bir frontend
    // sayfası/paketi gerektirmeden apps/api'nin kendisi sunuyor, tıpkı
    // gerçek Stripe'ın da apps/web'in DIŞINDA barınması gibi.
    return `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"><title>Mock Stripe Checkout</title>
<style>body{font-family:sans-serif;max-width:420px;margin:80px auto;text-align:center}
button{padding:10px 24px;font-size:15px;cursor:pointer;border-radius:999px;border:0;background:#171717;color:#fff}
p{color:#666}</style></head>
<body>
  <h1>Mock Stripe Checkout</h1>
  <p><strong>${this.escapeHtml(org.name)}</strong> için Pro plana geçiş — ${this.escapeHtml(sessionId)}</p>
  <p>Bu bir test/mock ödeme sayfasıdır — gerçek bir Stripe hesabı bağlı
  olmadığı için kart bilgisi istenmiyor.</p>
  <form method="post" action="/billing/mock-checkout/confirm">
    <input type="hidden" name="sessionId" value="${this.escapeHtml(sessionId)}">
    <input type="hidden" name="orgId" value="${this.escapeHtml(orgId)}">
    <input type="hidden" name="successUrl" value="${this.escapeHtml(successUrl)}">
    <input type="hidden" name="cancelUrl" value="${this.escapeHtml(cancelUrl)}">
    <input type="hidden" name="exp" value="${this.escapeHtml(exp)}">
    <input type="hidden" name="sig" value="${this.escapeHtml(sig)}">
    <button type="submit">Ödemeyi tamamla (mock)</button>
  </form>
  <p><a href="${this.escapeHtml(cancelUrl)}">Vazgeç</a></p>
</body>
</html>`;
  }

  // "Ödemeyi tamamla" tıklanınca — gerçek Stripe burada kartı tahsil edip
  // KENDİ sunucusundan bizim /billing/webhook'umuza bir HTTP POST yapar; biz
  // aynı şeyi taklit ediyoruz: event'i oluşturup gerçek imza formatıyla
  // imzalayıp kendi `/billing/webhook`'umuza GERÇEK bir HTTP isteği
  // gönderiyoruz (BillingService.handleWebhookEvent'i doğrudan çağırmak
  // yerine) — böylece imza doğrulama/parsing kodu prod'da gerçek Stripe'tan
  // gelecek istekle AYNI yoldan geçmiş oluyor, sadece çağıran taraf sahte.
  @Post('billing/mock-checkout/confirm')
  async confirmMockCheckout(
    @Body('sessionId') sessionId: string,
    @Body('orgId') orgId: string,
    @Body('successUrl') successUrl: string,
    @Body('cancelUrl') cancelUrl: string,
    @Body('exp') exp: string,
    @Body('sig') sig: string,
    @Res() res: Response,
  ) {
    const payload = this.parseLinkPayload(
      sessionId,
      orgId,
      successUrl,
      cancelUrl,
      exp,
    );
    this.billingService.getMockClient().verifyLinkPayload(payload, sig);

    const event: StripeCheckoutCompletedEvent = {
      id: `evt_mock_${sessionId}`,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          customer: `cus_mock_${orgId.slice(0, 8)}`,
          subscription: `sub_mock_${sessionId.slice(8)}`,
          metadata: { orgId },
        },
      },
    };
    const rawBody = JSON.stringify(event);
    const signature = this.billingService
      .getMockClient()
      .signWebhookPayload(rawBody);

    // Doğrudan handleWebhookEvent'i çağırıyoruz — kendi sunucumuza,
    // `req.get('host')`'tan türetilen bir origin'e HTTP round-trip'i ATMIYORUZ.
    // Eski hali bir SSRF'ti: bu uç auth'suz ve `trust proxy` kapalı olduğundan
    // saldırgan `Host` başlığıyla, geçerli bir `Stripe-Signature` taşıyan bir
    // POST'u keyfi bir hedefe gönderttirebiliyordu. İmza doğrulama/parsing kodu
    // (constructEvent) yine AYNI yoldan geçiyor — sadece network hop'u kalktı;
    // gerçek HTTP yolu zaten billing-webhook.integration-spec.ts'te
    // supertest ile ayrıca kanıtlanıyor.
    await this.billingService.handleWebhookEvent(rawBody, signature);

    res.redirect(302, successUrl);
  }

  // Gerçek Stripe Dashboard'da webhook endpoint'i olarak kayıtlı olacak uç —
  // rawBody (main.ts'teki `rawBody: true`) sayesinde imza, gövde TAM
  // OLARAK network'ten geldiği byte'larla doğrulanıyor (gerçek Stripe SDK'sı
  // da aynı sebeple JSON.parse edilmiş bir body değil, ham body ister).
  @Post('billing/webhook')
  async webhook(@Req() req: RawBodyRequest<Request>) {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      throw new UnauthorizedException('Stripe-Signature header eksik');
    }
    if (!req.rawBody) {
      throw new BadRequestException('Boş webhook gövdesi');
    }
    await this.billingService.handleWebhookEvent(
      req.rawBody.toString('utf-8'),
      signature,
    );
    return { received: true };
  }

  // Gerçek Stripe Customer Portal'ının en minimal karşılığı — kart bilgisi
  // GÖSTERİLİYOR ama sahte/placeholder (mock akışında gerçek bir kart hiç
  // toplanmadı, bkz. mockCheckoutPage), "Kartı güncelle" butonu bilinçli
  // olarak DEVRE DIŞI (0.1/prompt-library'nin izin verdiği "Customer Portal
  // linki placeholder olabilir" — gerçek olan tek akış "İptal et").
  @Get('billing/mock-portal')
  @Header('Content-Type', 'text/html; charset=utf-8')
  // Sayfaya özel sıkı CSP — bkz. mockCheckoutPage'deki aynı gerekçe.
  @Header(
    'Content-Security-Policy',
    "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'",
  )
  async mockPortalPage(
    @Query('orgId') orgId: string,
    @Query('returnUrl') returnUrl: string,
    @Query('exp') exp: string,
    @Query('sig') sig: string,
  ) {
    const payload = this.parsePortalLinkPayload(orgId, returnUrl, exp);
    this.billingService.getMockClient().verifyPortalLinkPayload(payload, sig);

    const { plan } = await this.billingService.getBillingOverview(orgId);

    return `<!doctype html>
<html lang="tr">
<head><meta charset="utf-8"><title>Mock Stripe Customer Portal</title>
<style>body{font-family:sans-serif;max-width:420px;margin:80px auto}
button{padding:10px 24px;font-size:15px;cursor:pointer;border-radius:999px;border:0}
.primary{background:#171717;color:#fff}
.danger{background:#fff;color:#b91c1c;border:1px solid #b91c1c}
button:disabled{opacity:.4;cursor:not-allowed}
p{color:#666}
.card{border:1px solid #ddd;border-radius:8px;padding:12px;margin:16px 0;font-family:monospace}
h1{font-size:18px}</style></head>
<body>
  <h1>Mock Stripe Customer Portal</h1>
  <p>Mevcut plan: <strong>${plan === 'PRO' ? 'Pro' : 'Free'}</strong></p>
  <div class="card">•••• •••• •••• 4242 (mock kart — gerçek bir Stripe hesabı yok)</div>
  <button class="primary" disabled title="Gerçek bir Stripe hesabı yok, bu buton placeholder">Kartı güncelle</button>
  ${
    plan === 'PRO'
      ? `<form method="post" action="/billing/mock-portal/cancel" style="margin-top:16px">
    <input type="hidden" name="orgId" value="${this.escapeHtml(orgId)}">
    <input type="hidden" name="returnUrl" value="${this.escapeHtml(returnUrl)}">
    <input type="hidden" name="exp" value="${this.escapeHtml(exp)}">
    <input type="hidden" name="sig" value="${this.escapeHtml(sig)}">
    <button type="submit" class="danger">Aboneliği iptal et</button>
  </form>`
      : `<p>Zaten Free plandasın.</p>`
  }
  <p><a href="${this.escapeHtml(returnUrl)}">← Geri dön</a></p>
</body>
</html>`;
  }

  // "Aboneliği iptal et" tıklanınca — gerçek Stripe Customer Portal'ında bu
  // aksiyon Stripe'ın kendi sunucusunda gerçekleşir; burada kendi
  // backend'imiz olduğu için (mockPortalPage de bizim sunduğumuz bir sayfa)
  // doğrudan BillingService.cancelSubscription çağırmak yeterli — 6.1/
  // confirmMockCheckout'un aksine burada taklit edilecek AYRI bir
  // sunucu-sunucu webhook yolu yok (Stripe'ın "abonelik iptal edildi" bilgisi
  // KENDİ portal'ından geldiği için zaten kendi tarafında, ekstra bir HTTP
  // round-trip'i sahte bir gerçekçilik katardı, gerçek bir garanti değil).
  @Post('billing/mock-portal/cancel')
  async cancelMockPortalSubscription(
    @Body('orgId') orgId: string,
    @Body('returnUrl') returnUrl: string,
    @Body('exp') exp: string,
    @Body('sig') sig: string,
    @Res() res: Response,
  ) {
    const payload = this.parsePortalLinkPayload(orgId, returnUrl, exp);
    this.billingService.getMockClient().verifyPortalLinkPayload(payload, sig);

    await this.billingService.cancelSubscription(orgId);

    res.redirect(302, returnUrl);
  }

  private parseLinkPayload(
    sessionId: string,
    orgId: string,
    successUrl: string,
    cancelUrl: string,
    exp: string,
  ): MockCheckoutLinkPayload {
    const parsedExp = Number(exp);
    if (
      !sessionId ||
      !orgId ||
      !successUrl ||
      !cancelUrl ||
      !Number.isFinite(parsedExp)
    ) {
      throw new BadRequestException('Eksik/geçersiz checkout linki');
    }
    return { sessionId, orgId, successUrl, cancelUrl, exp: parsedExp };
  }

  private parsePortalLinkPayload(
    orgId: string,
    returnUrl: string,
    exp: string,
  ): MockPortalLinkPayload {
    const parsedExp = Number(exp);
    if (!orgId || !returnUrl || !Number.isFinite(parsedExp)) {
      throw new BadRequestException('Eksik/geçersiz portal linki');
    }
    return { orgId, returnUrl, exp: parsedExp };
  }

  private escapeHtml(value: string): string {
    return (
      value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        // Tek tırnak da kaçırılıyor — bu sayfalar çift-tırnaklı attribute
        // kullanıyor ama biri gelecekte tek-tırnaklı bir attribute eklerse
        // sessiz bir XSS açılmasın (savunma derinliği; CSP ile birlikte).
        .replace(/'/g, '&#39;')
    );
  }
}
