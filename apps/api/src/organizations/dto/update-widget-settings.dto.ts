import {
  IsHexColor,
  IsOptional,
  IsUrl,
  MaxLength,
  ValidateIf,
} from 'class-validator';

// CreateTagDto'daki IsHexColor ile aynı desen (tags/dto/create-tag.dto.ts).
// logoUrl'de ValidateIf: boş string "logoyu kaldır" anlamına gelir (bkz.
// OrganizationsService.updateWidgetSettings) — IsUrl boş string'i reddeder,
// bu yüzden sadece dolu bir değer verildiğinde URL formatı kontrol ediliyor.
export class UpdateWidgetSettingsDto {
  @IsOptional()
  @IsHexColor()
  color?: string;

  @IsOptional()
  @ValidateIf((o: UpdateWidgetSettingsDto) => o.logoUrl !== '')
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true })
  @MaxLength(2048)
  logoUrl?: string;
}
