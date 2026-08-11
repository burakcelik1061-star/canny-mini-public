import { IsUrl } from 'class-validator';

// Gerçek Stripe Checkout Session API'siyle aynı iki alan
// (`success_url`/`cancel_url`) — frontend ödeme sonrası/iptalinde nereye
// dönüleceğini kendisi belirler (bugün admin ayarlar sayfası, Faz 6.3'te
// gerçek billing sayfası).
// require_tld: false — local dev'de `http://localhost:3000/...` gibi
// TLD'siz URL'ler de geçerli (widget branding'deki logoUrl'in aksine, bu
// alanlar HER ZAMAN apps/web'in kendi origin'i, dışarıdan gelen keyfi bir
// link değil).
export class CreateCheckoutSessionDto {
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  successUrl!: string;

  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  cancelUrl!: string;
}
