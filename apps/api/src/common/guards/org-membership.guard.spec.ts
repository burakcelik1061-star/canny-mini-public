import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { OrgMembershipGuard } from './org-membership.guard';

function makeContext(params: Record<string, string>, user?: object) {
  const request: Record<string, unknown> = { params, user };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => jest.fn(),
    getClass: () => jest.fn(),
  } as unknown as ExecutionContext;
}

describe('OrgMembershipGuard', () => {
  let guard: OrgMembershipGuard;
  let prisma: { organizationMember: { findUnique: jest.Mock } };
  let reflector: { getAllAndOverride: jest.Mock };

  beforeEach(async () => {
    prisma = { organizationMember: { findUnique: jest.fn() } };
    reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OrgMembershipGuard,
        { provide: PrismaService, useValue: prisma },
        { provide: Reflector, useValue: reflector },
      ],
    }).compile();

    guard = moduleRef.get(OrgMembershipGuard);
  });

  it(":orgId param'ı olmayan bir route'a eklenmişse hata fırlatır (programcı hatası)", async () => {
    const context = makeContext({}, { sub: 'user-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      "OrgMembershipGuard, ':orgId' route param'ı olmayan bir route'a eklenmiş",
    );
  });

  it('request.user yoksa (JwtAccessGuard önce çalışmamışsa) ForbiddenException fırlatır', async () => {
    const context = makeContext({ orgId: 'org-1' }, undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("kullanıcı org'a üye değilse ForbiddenException fırlatır — başka org'un kullanıcısı bu org'un verisine erişemez", async () => {
    prisma.organizationMember.findUnique.mockResolvedValue(null);
    const context = makeContext(
      { orgId: 'org-1' },
      { sub: 'outsider-from-another-org' },
    );

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
    expect(prisma.organizationMember.findUnique).toHaveBeenCalledWith({
      where: {
        orgId_userId: { orgId: 'org-1', userId: 'outsider-from-another-org' },
      },
    });
  });

  it('rol gerekliyse ve üyenin rolü yetersizse ForbiddenException fırlatır', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({
      role: 'MEMBER',
    });
    reflector.getAllAndOverride.mockReturnValue(['OWNER', 'ADMIN']);
    const context = makeContext({ orgId: 'org-1' }, { sub: 'user-1' });

    await expect(guard.canActivate(context)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('rol istenmiyorsa herhangi bir üyelik yeterlidir', async () => {
    prisma.organizationMember.findUnique.mockResolvedValue({
      role: 'MEMBER',
    });
    reflector.getAllAndOverride.mockReturnValue(undefined);
    const context = makeContext({ orgId: 'org-1' }, { sub: 'user-1' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("üyenin rolü yeterliyse geçişe izin verir ve üyeliği request'e ekler", async () => {
    const membership = { role: 'OWNER', orgId: 'org-1', userId: 'user-1' };
    prisma.organizationMember.findUnique.mockResolvedValue(membership);
    reflector.getAllAndOverride.mockReturnValue(['OWNER', 'ADMIN']);
    const request: Record<string, unknown> = {
      params: { orgId: 'org-1' },
      user: { sub: 'user-1' },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
      getHandler: () => jest.fn(),
      getClass: () => jest.fn(),
    } as unknown as ExecutionContext;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.orgMembership).toBe(membership);
  });
});
