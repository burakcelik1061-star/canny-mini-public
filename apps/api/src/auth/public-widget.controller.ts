import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AUTH_THROTTLE } from '../common/throttler.constants';
import { OrganizationsService } from '../organizations/organizations.service';
import { AuthService } from './auth.service';
import { WidgetIdentifyDto } from './dto/widget-identify.dto';

// Bilinçli olarak `/public/:orgSlug/...` DEĞİL, ayrı bir `/widget/:orgSlug`
// namespace'i: PostsController zaten `public/:orgSlug/:boardSlug` (2 segment)
// dinliyor — `public/:orgSlug/branding` de aynı derinlikte (orgSlug + tek
// segment) olurdu ve Express/Nest route eşleştirmesi kayıt SIRASINA bağlı
// olurdu (`:boardSlug="branding"` PostsController'a mı düşer yoksa buraya mı
// — kırılgan, örtük bir varsayıma dayanırdı). Farklı bir üst segment bu
// belirsizliği kökten kaldırıyor.
@Controller('widget/:orgSlug')
export class PublicWidgetController {
  constructor(
    private readonly authService: AuthService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  // Auth gerektirmez — org'un adı/varlığı zaten public (canny-mini.com/:orgSlug
  // üzerinden herkes board'ları görebiliyor), renk/logo da aynı görünürlükte.
  @Get('branding')
  async getBranding(@Param('orgSlug') orgSlug: string) {
    return this.organizationsService.getPublicBranding(orgSlug);
  }

  // Faz 7.4 — auth uçlarıyla aynı dar limit: identify de bir kimlik
  // doğrulama ucu (HMAC imzası deneyen bir saldırgan için aynı hedef).
  @Throttle({ default: AUTH_THROTTLE })
  @Post('identify')
  @HttpCode(HttpStatus.OK)
  async identify(
    @Param('orgSlug') orgSlug: string,
    @Body() dto: WidgetIdentifyDto,
  ) {
    return this.authService.identifyWidgetUser(orgSlug, dto);
  }
}
