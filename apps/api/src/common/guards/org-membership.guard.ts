import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { OrganizationMember, OrgRole } from '@prisma/client';
import { Request } from 'express';
import { JwtPayload } from '../../auth/types/jwt-payload.type';
import { PrismaService } from '../../prisma/prisma.service';
import { ORG_ROLES_KEY } from '../decorators/org-roles.decorator';

export interface RequestWithOrgMembership extends Request {
  orgMembership: OrganizationMember;
}

// Faz 1.4'ün amacı: "bir org'un verisine başka org'un kullanıcısı asla
// erişemesin" garantisini tek, tekrar kullanılabilir bir yerde uygula —
// ad-hoc kontroller her serviste ayrı ayrı yazılmasın (bkz. 1.3'te
// InvitationsService.assertCanInvite, buraya taşındı). Faz 2+'daki
// Board/Post gibi org-scoped kaynaklar da aynı guard'ı kullanacak.
//
// Önkoşullar:
// - Bu guard'tan ÖNCE JwtAccessGuard çalışmış olmalı (request.user dolu olsun).
// - Route'ta bir `:orgId` path param'ı olmalı.
@Injectable()
export class OrgMembershipGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithOrgMembership>();
    // Express, tekrarlanan query/path param'larda string[] üretebilir;
    // bizim route'larımızda :orgId her zaman tek segment.
    const orgId = Array.isArray(request.params.orgId)
      ? request.params.orgId[0]
      : request.params.orgId;
    const user = request.user as JwtPayload | undefined;

    if (!orgId) {
      // Programcı hatası: guard, :orgId param'ı olmayan bir route'a
      // eklenmiş. Sessizce geçirmek "izolasyon garantisi"ni anlamsız
      // kılar — erken ve gürültülü patlamalı.
      throw new Error(
        "OrgMembershipGuard, ':orgId' route param'ı olmayan bir route'a eklenmiş",
      );
    }
    if (!user) {
      throw new ForbiddenException();
    }

    const membership = await this.prisma.organizationMember.findUnique({
      where: { orgId_userId: { orgId, userId: user.sub } },
    });

    if (!membership) {
      throw new ForbiddenException('Bu organizasyona üye değilsin');
    }

    // getAllAndOverride: hem handler hem CLASS seviyesindeki @OrgRoles'u
    // okur (handler kazanır). Sadece getHandler()'a bakmak, birinin
    // @OrgRoles'u tüm controller'a (class'a) koyması durumunda dekoratörü
    // SESSİZCE yok sayardı — o an tüm MEMBER'lar admin-only uçlara geçerdi.
    const requiredRoles = this.reflector.getAllAndOverride<
      OrgRole[] | undefined
    >(ORG_ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (
      requiredRoles &&
      requiredRoles.length > 0 &&
      !requiredRoles.includes(membership.role)
    ) {
      throw new ForbiddenException('Bu işlem için yeterli yetkin yok');
    }

    request.orgMembership = membership;
    return true;
  }
}
