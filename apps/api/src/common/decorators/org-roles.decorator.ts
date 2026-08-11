import { SetMetadata } from '@nestjs/common';
import { OrgRole } from '@prisma/client';

export const ORG_ROLES_KEY = 'orgRoles';

// Hiç rol verilmezse OrgMembershipGuard sadece "bu org'a üye mi" kontrolü
// yapar (herhangi bir rol yeter); rol(ler) verilirse üyeliğin rolü de o
// listede olmalı. Kullanım: @OrgRoles('OWNER', 'ADMIN')
export const OrgRoles = (...roles: OrgRole[]) =>
  SetMetadata(ORG_ROLES_KEY, roles);
