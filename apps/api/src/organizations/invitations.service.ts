import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Invitation, InvitationStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import { PlanLimitExceededException } from '../billing/plan-limit.exception';
import { PLAN_LIMITS } from '../billing/plan-limits';
import { PrismaService } from '../prisma/prisma.service';
import { CreateInvitationDto } from './dto/create-invitation.dto';

const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 gün

export interface PublicInvitation {
  organizationId: string;
  organizationName: string;
  email: string;
  role: Invitation['role'];
  status: InvitationStatus;
}

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  // "Davet edenin owner/admin olması" kontrolü artık burada değil —
  // OrgMembershipGuard + @OrgRoles('OWNER', 'ADMIN') route'ta yapıyor (bkz.
  // OrganizationsController.invite). Servis, çağrıldığında yetkinin zaten
  // doğrulanmış olduğunu varsayar; sadece iş kuralına (zaten üye mi, aynı
  // email'e tekrar davet) odaklanır.
  async createInvitation(
    orgId: string,
    dto: CreateInvitationDto,
  ): Promise<Invitation> {
    await this.assertWithinMemberLimit(orgId);

    const email = dto.email.toLowerCase().trim();

    const existingUser = await this.prisma.user.findUnique({
      where: { email },
    });
    if (existingUser) {
      const alreadyMember = await this.prisma.organizationMember.findUnique({
        where: { orgId_userId: { orgId, userId: existingUser.id } },
      });
      if (alreadyMember) {
        throw new ConflictException('Bu kullanıcı zaten organizasyon üyesi');
      }
    }

    const token = randomBytes(32).toString('hex');

    // Aynı email için zaten bekleyen bir davet varsa yeni bir satır açmak
    // yerine onu tazeliyoruz (yeni token, yeni 7 günlük süre) — tekrar davet
    // etmek eski linki de canlı tutan kafa karıştırıcı bir durum yaratmasın.
    const existingPending = await this.prisma.invitation.findFirst({
      where: { orgId, email, status: 'PENDING' },
    });

    if (existingPending) {
      return this.prisma.invitation.update({
        where: { id: existingPending.id },
        data: { role: dto.role, token, createdAt: new Date() },
      });
    }

    return this.prisma.invitation.create({
      data: { orgId, email, role: dto.role, token },
    });
  }

  async getByToken(token: string): Promise<PublicInvitation> {
    const invitation = await this.findValidatedByToken(token);

    return {
      organizationId: invitation.orgId,
      organizationName: invitation.organizationName,
      email: invitation.email,
      role: invitation.role,
      status: invitation.status,
    };
  }

  // AuthService.register, kullanıcıyı DB'ye yazmadan ÖNCE token'ın geçerli
  // olduğunu bilmek istiyor (geçersiz/süresi dolmuş bir token yüzünden yarım
  // kalmış bir User satırı bırakmamak için). Aynı kontrolü redeemInvitation
  // de (asıl işlemden hemen önce, savunma amaçlı ikinci kez) çalıştırıyor.
  async assertRedeemable(token: string, email: string): Promise<void> {
    const invitation = await this.findValidatedByToken(token);
    this.assertPendingAndOwnedBy(invitation, email);
  }

  // Hem "zaten giriş yapmış kullanıcı davet linkine tıkladı" (invitations
  // controller) hem "davet linkiyle register oluyor" (AuthService.register)
  // akışları aynı bu metodu çağırıyor — tek doğruluk kaynağı.
  async redeemInvitation(
    token: string,
    user: { id: string; email: string },
  ): Promise<{ organizationId: string; role: Invitation['role'] }> {
    const invitation = await this.findValidatedByToken(token);
    this.assertPendingAndOwnedBy(invitation, user.email);

    await this.prisma.$transaction(async (tx) => {
      await tx.organizationMember.upsert({
        where: {
          orgId_userId: { orgId: invitation.orgId, userId: user.id },
        },
        create: {
          orgId: invitation.orgId,
          userId: user.id,
          role: invitation.role,
        },
        update: {}, // zaten üyeyse (ör. tekrar tıklanan link) sessizce no-op
      });
      await tx.invitation.update({
        where: { id: invitation.id },
        data: { status: 'ACCEPTED' },
      });
    });

    return { organizationId: invitation.orgId, role: invitation.role };
  }

  private assertPendingAndOwnedBy(invitation: Invitation, email: string): void {
    if (invitation.status !== 'PENDING') {
      throw new GoneException(
        invitation.status === 'ACCEPTED'
          ? 'Bu davet zaten kabul edilmiş'
          : 'Bu davetin süresi dolmuş',
      );
    }

    if (invitation.email.toLowerCase() !== email.toLowerCase()) {
      throw new ForbiddenException(
        'Bu davet başka bir email adresi için gönderilmiş',
      );
    }
  }

  // Token'ı bulur, süresi dolmuşsa (7 gün) durumunu kalıcı olarak EXPIRED'a
  // çevirir (self-healing) ve org adıyla birlikte döner.
  private async findValidatedByToken(
    token: string,
  ): Promise<Invitation & { organizationName: string }> {
    const invitation = await this.prisma.invitation.findUnique({
      where: { token },
      include: { organization: { select: { name: true } } },
    });

    if (!invitation) {
      throw new NotFoundException('Davet bulunamadı');
    }

    const isExpired =
      invitation.status === 'PENDING' &&
      Date.now() - invitation.createdAt.getTime() > INVITATION_TTL_MS;

    if (isExpired) {
      await this.prisma.invitation.update({
        where: { id: invitation.id },
        data: { status: 'EXPIRED' },
      });
      invitation.status = 'EXPIRED';
    }

    const { organization, ...rest } = invitation;
    return { ...rest, organizationName: organization.name };
  }

  // Faz 6.2 — sadece KABUL EDİLMİŞ üyeliği (`OrganizationMember`) sayıyoruz,
  // bekleyen davetleri değil (bilinçli bir basitleştirme: birden fazla
  // davet aynı anda gönderilip hepsi kabul edilirse limit anlık olarak
  // aşılabilir — kapsam dışı bırakıldı, redeemInvitation'da AYRICA
  // kontrol etmek "davet gönderildi ama kabul edilemedi" gibi kafa
  // karıştırıcı bir UX'e yol açardı). Org sahipliği/varlığı bu noktaya
  // gelmeden önce OrgMembershipGuard tarafından zaten doğrulanmış.
  private async assertWithinMemberLimit(orgId: string): Promise<void> {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { plan: true, _count: { select: { members: true } } },
    });
    if (!org) {
      return;
    }

    const { maxMembers } = PLAN_LIMITS[org.plan];
    if (maxMembers !== null && org._count.members >= maxMembers) {
      throw new PlanLimitExceededException(
        `Free plan en fazla ${maxMembers} üyeye izin veriyor — daha fazla üye için Pro'ya yükselt`,
      );
    }
  }
}
