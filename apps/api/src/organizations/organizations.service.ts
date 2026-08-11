import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Organization, OrgRole, Prisma } from '@prisma/client';
import { randomBytes } from 'crypto';
import { slugify } from '../common/slugify';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateWidgetSettingsDto } from './dto/update-widget-settings.dto';

const WIDGET_SECRET_BYTES = 32; // HMAC-SHA256 anahtarı için yeterli entropi (256 bit)

// packages/shared'daki Organization/OrgRole tipleri kullanılmadı: onlar
// HTTP JSON kontratını temsil ediyor (createdAt: string, role küçük harf),
// burada ise gerçek Prisma dönüş şekli kullanılıyor (createdAt: Date, role
// UPPER_CASE) — auth.service.ts'deki SafeUser ile aynı yaklaşım.
export type MyOrganization = Organization & { role: OrgRole };

const PRISMA_UNIQUE_CONSTRAINT_VIOLATION = 'P2002';

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async createOrganization(
    ownerId: string,
    dto: CreateOrganizationDto,
  ): Promise<MyOrganization> {
    const name = dto.name.trim();
    const slug = await this.generateUniqueSlug(name);

    try {
      const organization = await this.prisma.$transaction(async (tx) => {
        // widgetSecret migration'da NOT NULL yapıldı (bkz. o migration'ın
        // yorumu) — her yeni org burada, uygulama kodunda üretmek zorunda.
        const widgetSecret = randomBytes(WIDGET_SECRET_BYTES).toString('hex');
        const org = await tx.organization.create({
          data: { name, slug, widgetSecret },
        });
        await tx.organizationMember.create({
          data: { orgId: org.id, userId: ownerId, role: 'OWNER' },
        });
        return org;
      });

      return { ...organization, role: 'OWNER' };
    } catch (error) {
      // generateUniqueSlug ile insert arasında (çok nadir) bir yarış olursa
      // DB'deki unique constraint son savunma hattı — kullanıcıya anlamlı
      // bir hata dönelim, ham Prisma hatası sızmasın.
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === PRISMA_UNIQUE_CONSTRAINT_VIOLATION
      ) {
        throw new ConflictException(
          'Bu isimle bir workspace az önce oluşturuldu, tekrar deneyin',
        );
      }
      throw error;
    }
  }

  async getMyOrganizations(userId: string): Promise<MyOrganization[]> {
    const memberships = await this.prisma.organizationMember.findMany({
      where: { userId },
      include: { organization: true },
      orderBy: { joinedAt: 'asc' },
    });

    return memberships.map((membership) => ({
      ...membership.organization,
      role: membership.role,
    }));
  }

  // Widget'ın kendisinin çektiği public branding (4.3) — org'un varlığını
  // "bulunamadı" ile gizlemiyoruz burada (getPublicBoard'daki gibi private
  // bir kaynak değil, sadece renk/logo), ama org gerçekten yoksa yine de
  // 404 dönmek widget'ın hatayı ayırt edebilmesi için gerekli.
  async getPublicBranding(
    orgSlug: string,
  ): Promise<{ color: string; logoUrl: string | null }> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { widgetColor: true, widgetLogoUrl: true },
    });
    if (!org) {
      throw new NotFoundException('Workspace bulunamadı');
    }
    return { color: org.widgetColor, logoUrl: org.widgetLogoUrl };
  }

  // AuthService.identifyWidgetUser'ın imza doğrulaması için — widgetSecret
  // ASLA bu metodun dışına, herhangi bir public response'a sızmamalı (bkz.
  // getWidgetSettings'in OWNER|ADMIN kısıtı).
  async getOrgWidgetSecret(
    orgSlug: string,
  ): Promise<{ id: string; widgetSecret: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { slug: orgSlug },
      select: { id: true, widgetSecret: true },
    });
    if (!org) {
      throw new NotFoundException('Workspace bulunamadı');
    }
    return org;
  }

  // OrgMembershipGuard + @OrgRoles('OWNER','ADMIN') zaten çağıran tarafta
  // (OrganizationsController) uygulanıyor — orgId burada zaten doğrulanmış
  // bir üyelikten geliyor, bu yüzden bulunamama durumu programcı hatası
  // sayılır (NotFoundException yine de savunma amaçlı).
  async getWidgetSettings(
    orgId: string,
  ): Promise<{ color: string; logoUrl: string | null; secret: string }> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { widgetColor: true, widgetLogoUrl: true, widgetSecret: true },
    });
    if (!org) {
      throw new NotFoundException('Workspace bulunamadı');
    }
    return {
      color: org.widgetColor,
      logoUrl: org.widgetLogoUrl,
      secret: org.widgetSecret,
    };
  }

  async updateWidgetSettings(
    orgId: string,
    dto: UpdateWidgetSettingsDto,
  ): Promise<{ color: string; logoUrl: string | null }> {
    const data: Prisma.OrganizationUpdateInput = {};
    if (dto.color !== undefined) {
      data.widgetColor = dto.color;
    }
    if (dto.logoUrl !== undefined) {
      // Boş string = "logoyu kaldır" (bkz. UpdateWidgetSettingsDto yorumu).
      data.widgetLogoUrl = dto.logoUrl || null;
    }
    const org = await this.prisma.organization.update({
      where: { id: orgId },
      data,
      select: { widgetColor: true, widgetLogoUrl: true },
    });
    return { color: org.widgetColor, logoUrl: org.widgetLogoUrl };
  }

  // Secret sızmış/rotate edilmesi istenmiş olabilir — döndürülen yeni
  // secret'tan sonra ESKİ secret'la imzalanmış hiçbir identify isteği
  // geçerli olmaz (host'un kendi backend'inin de güncellemesi gerekir).
  async rotateWidgetSecret(orgId: string): Promise<{ secret: string }> {
    const widgetSecret = randomBytes(WIDGET_SECRET_BYTES).toString('hex');
    await this.prisma.organization.update({
      where: { id: orgId },
      data: { widgetSecret },
    });
    return { secret: widgetSecret };
  }

  private async generateUniqueSlug(name: string): Promise<string> {
    const base = slugify(name) || 'workspace';
    let candidate = base;
    let suffix = 2;

    while (
      await this.prisma.organization.findUnique({ where: { slug: candidate } })
    ) {
      candidate = `${base}-${suffix}`;
      suffix += 1;
    }

    return candidate;
  }
}
