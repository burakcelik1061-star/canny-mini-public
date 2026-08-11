import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import type { JwtPayload } from '../auth/types/jwt-payload.type';
import { OrgRoles } from '../common/decorators/org-roles.decorator';
import { OrgMembershipGuard } from '../common/guards/org-membership.guard';
import { CreateInvitationDto } from './dto/create-invitation.dto';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateWidgetSettingsDto } from './dto/update-widget-settings.dto';
import { InvitationsService } from './invitations.service';
import { OrganizationsService } from './organizations.service';

@UseGuards(JwtAccessGuard)
@Controller('organizations')
export class OrganizationsController {
  constructor(
    private readonly organizationsService: OrganizationsService,
    private readonly invitationsService: InvitationsService,
  ) {}

  @Post()
  async create(
    @CurrentUser() user: JwtPayload,
    @Body() dto: CreateOrganizationDto,
  ) {
    return this.organizationsService.createOrganization(user.sub, dto);
  }

  @Get()
  async findMine(@CurrentUser() user: JwtPayload) {
    return this.organizationsService.getMyOrganizations(user.sub);
  }

  // Faz 5'e kadar email gönderen bir servis yok (Resend/SendGrid) — davet
  // linki (token) doğrudan response'ta dönüyor ki curl/Postman ile test
  // edilebilsin. Faz 5.2'de bu token email içine taşınacak, response'tan
  // kaldırılacak.
  //
  // Org izolasyonu: OrgMembershipGuard, :orgId'nin body/URL'den değil
  // request.user (JWT) + DB'den doğrulanmış üyelikten geldiğini garanti
  // eder — başka bir org'un OWNER'ı bile bu org'a davet gönderemez.
  @UseGuards(OrgMembershipGuard)
  @OrgRoles('OWNER', 'ADMIN')
  @Post(':orgId/invitations')
  async invite(
    @Param('orgId') orgId: string,
    @Body() dto: CreateInvitationDto,
  ) {
    return this.invitationsService.createInvitation(orgId, dto);
  }

  // Faz 4.3 — widget tema/kimlik ayarları. `secret` içeriyor (host'un kendi
  // backend'inin identify imzalaması için, bkz. schema.prisma'daki
  // widgetSecret yorumu) — bu yüzden invitations gibi OWNER|ADMIN'e kısıtlı,
  // board listeleme (herkese açık üyeliğe) göre daha sıkı.
  @UseGuards(OrgMembershipGuard)
  @OrgRoles('OWNER', 'ADMIN')
  @Get(':orgId/widget-settings')
  async getWidgetSettings(@Param('orgId') orgId: string) {
    return this.organizationsService.getWidgetSettings(orgId);
  }

  @UseGuards(OrgMembershipGuard)
  @OrgRoles('OWNER', 'ADMIN')
  @Patch(':orgId/widget-settings')
  async updateWidgetSettings(
    @Param('orgId') orgId: string,
    @Body() dto: UpdateWidgetSettingsDto,
  ) {
    return this.organizationsService.updateWidgetSettings(orgId, dto);
  }

  // Ayrı bir POST — PATCH'e "rotate: true" gibi bir alan eklemek yerine,
  // rotate hem idempotent değil (her çağrı yeni bir secret üretir) hem de
  // farklı bir izin/anlam taşıyor (mevcut secret'ı geçersiz kılmak, sadece
  // güncellemek değil) — ayrı bir endpoint bunu daha net ifade ediyor.
  @UseGuards(OrgMembershipGuard)
  @OrgRoles('OWNER', 'ADMIN')
  @Post(':orgId/widget-settings/rotate-secret')
  async rotateWidgetSecret(@Param('orgId') orgId: string) {
    return this.organizationsService.rotateWidgetSecret(orgId);
  }
}
