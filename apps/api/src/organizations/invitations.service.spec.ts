import {
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PlanLimitExceededException } from '../billing/plan-limit.exception';
import { PrismaService } from '../prisma/prisma.service';
import { InvitationsService } from './invitations.service';

const now = new Date();

const mockInvitation = {
  id: 'inv-1',
  orgId: 'org-1',
  email: 'invitee@example.com',
  role: 'MEMBER' as const,
  token: 'tok-123',
  status: 'PENDING' as const,
  createdAt: now,
  organization: { name: 'Acme Corp' },
};

describe('InvitationsService', () => {
  let service: InvitationsService;
  let prisma: {
    organization: { findUnique: jest.Mock };
    organizationMember: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
    };
    user: { findUnique: jest.Mock };
    invitation: {
      findUnique: jest.Mock;
      findFirst: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      organization: { findUnique: jest.fn() },
      organizationMember: { findUnique: jest.fn(), upsert: jest.fn() },
      user: { findUnique: jest.fn() },
      invitation: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    // Faz 6.2 — çoğu testin limit kontrolüyle ilgisi yok, varsayılan olarak
    // FREE ama limitin ALTINDA (1/3 üye) döner; limit senaryoları kendi
    // testinde bunu override ediyor.
    prisma.organization.findUnique.mockResolvedValue({
      plan: 'FREE',
      _count: { members: 1 },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        InvitationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(InvitationsService);
  });

  describe('createInvitation', () => {
    // "Davet edenin owner/admin olması" artık OrgMembershipGuard'ın işi
    // (bkz. org-membership.guard.spec.ts) — servis bunu varsaymıyor, test
    // etmiyor.

    it('email zaten org üyesineyse ConflictException fırlatır', async () => {
      prisma.organizationMember.findUnique.mockResolvedValue({
        role: 'MEMBER',
      });
      prisma.user.findUnique.mockResolvedValue({ id: 'existing-user' });

      await expect(
        service.createInvitation('org-1', {
          email: 'invitee@example.com',
          role: 'MEMBER',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('geçerli davette yeni bir token üretip kaydeder', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitation.findFirst.mockResolvedValue(null);
      prisma.invitation.create.mockResolvedValue(mockInvitation);

      const result = await service.createInvitation('org-1', {
        email: 'invitee@example.com',
        role: 'MEMBER',
      });

      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest.fn() mock çağrı argümanları any */
      expect(prisma.invitation.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            orgId: 'org-1',
            email: 'invitee@example.com',
            role: 'MEMBER',
          }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
      expect(result).toBe(mockInvitation);
    });

    it('aynı email için bekleyen davet varsa yeni satır açmaz, mevcut olanı tazeler', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitation.findFirst.mockResolvedValue(mockInvitation);
      prisma.invitation.update.mockResolvedValue(mockInvitation);

      await service.createInvitation('org-1', {
        email: 'invitee@example.com',
        role: 'ADMIN',
      });

      expect(prisma.invitation.create).not.toHaveBeenCalled();
      /* eslint-disable @typescript-eslint/no-unsafe-assignment -- jest.fn() mock çağrı argümanları any */
      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: mockInvitation.id },
          data: expect.objectContaining({ role: 'ADMIN' }),
        }),
      );
      /* eslint-enable @typescript-eslint/no-unsafe-assignment */
    });

    it("FREE plan üye limitine ULAŞMIŞ bir org'da PlanLimitExceededException fırlatır, hiçbir davet oluşturmaz", async () => {
      prisma.organization.findUnique.mockResolvedValue({
        plan: 'FREE',
        _count: { members: 3 }, // PLAN_LIMITS.FREE.maxMembers
      });

      await expect(
        service.createInvitation('org-1', {
          email: 'invitee@example.com',
          role: 'MEMBER',
        }),
      ).rejects.toThrow(PlanLimitExceededException);
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(prisma.invitation.create).not.toHaveBeenCalled();
    });

    it("PRO plan org'da üye sayısı ne olursa olsun limit kontrolüne takılmaz", async () => {
      prisma.organization.findUnique.mockResolvedValue({
        plan: 'PRO',
        _count: { members: 50 },
      });
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.invitation.findFirst.mockResolvedValue(null);
      prisma.invitation.create.mockResolvedValue(mockInvitation);

      await expect(
        service.createInvitation('org-1', {
          email: 'invitee@example.com',
          role: 'MEMBER',
        }),
      ).resolves.toBe(mockInvitation);
    });
  });

  describe('getByToken', () => {
    it('token bulunamazsa NotFoundException fırlatır', async () => {
      prisma.invitation.findUnique.mockResolvedValue(null);

      await expect(service.getByToken('missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('7 günü geçmiş PENDING daveti EXPIRED olarak günceller ve öyle döner', async () => {
      const staleInvitation = {
        ...mockInvitation,
        createdAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
      };
      prisma.invitation.findUnique.mockResolvedValue(staleInvitation);
      prisma.invitation.update.mockResolvedValue({
        ...staleInvitation,
        status: 'EXPIRED',
      });

      const result = await service.getByToken('tok-123');

      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: staleInvitation.id },
        data: { status: 'EXPIRED' },
      });
      expect(result.status).toBe('EXPIRED');
    });

    it('geçerli daveti org adıyla birlikte döner', async () => {
      prisma.invitation.findUnique.mockResolvedValue(mockInvitation);

      const result = await service.getByToken('tok-123');

      expect(result).toEqual({
        organizationId: 'org-1',
        organizationName: 'Acme Corp',
        email: 'invitee@example.com',
        role: 'MEMBER',
        status: 'PENDING',
      });
    });
  });

  describe('redeemInvitation', () => {
    it('davet zaten kabul edilmişse GoneException fırlatır', async () => {
      prisma.invitation.findUnique.mockResolvedValue({
        ...mockInvitation,
        status: 'ACCEPTED',
      });

      await expect(
        service.redeemInvitation('tok-123', {
          id: 'user-1',
          email: 'invitee@example.com',
        }),
      ).rejects.toThrow(GoneException);
    });

    it("davetteki email ile kullanıcının email'i uyuşmazsa ForbiddenException fırlatır", async () => {
      prisma.invitation.findUnique.mockResolvedValue(mockInvitation);

      await expect(
        service.redeemInvitation('tok-123', {
          id: 'user-1',
          email: 'someone-else@example.com',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('geçerli davet için üyelik oluşturur ve daveti ACCEPTED yapar', async () => {
      prisma.invitation.findUnique.mockResolvedValue(mockInvitation);
      const tx = {
        organizationMember: { upsert: jest.fn().mockResolvedValue({}) },
        invitation: { update: jest.fn().mockResolvedValue({}) },
      };
      prisma.$transaction.mockImplementation((cb: (tx: typeof tx) => unknown) =>
        cb(tx),
      );

      const result = await service.redeemInvitation('tok-123', {
        id: 'user-1',
        email: 'invitee@example.com',
      });

      expect(tx.organizationMember.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { orgId_userId: { orgId: 'org-1', userId: 'user-1' } },
          create: { orgId: 'org-1', userId: 'user-1', role: 'MEMBER' },
        }),
      );
      expect(tx.invitation.update).toHaveBeenCalledWith({
        where: { id: 'inv-1' },
        data: { status: 'ACCEPTED' },
      });
      expect(result).toEqual({ organizationId: 'org-1', role: 'MEMBER' });
    });
  });
});
