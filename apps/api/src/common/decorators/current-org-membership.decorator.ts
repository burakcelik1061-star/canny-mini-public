import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OrganizationMember } from '@prisma/client';
import type { RequestWithOrgMembership } from '../guards/org-membership.guard';

// OrgMembershipGuard zaten üyeliği bir kez DB'den çekip request'e koyuyor —
// controller/service bunu tekrar sorgulamak yerine buradan alabilir.
export const CurrentOrgMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationMember => {
    const request = ctx.switchToHttp().getRequest<RequestWithOrgMembership>();
    return request.orgMembership;
  },
);
