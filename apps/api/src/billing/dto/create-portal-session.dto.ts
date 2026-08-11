import { IsUrl } from 'class-validator';

// CreateCheckoutSessionDto'daki aynı `require_tld: false` gerekçesi — bu
// her zaman apps/web'in kendi origin'i, local dev'de `http://localhost:3000`.
export class CreatePortalSessionDto {
  @IsUrl({
    protocols: ['http', 'https'],
    require_protocol: true,
    require_tld: false,
  })
  returnUrl!: string;
}
