import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PlanLimitExceededException } from '../billing/plan-limit.exception';
import { PrismaService } from '../prisma/prisma.service';
import { BoardsService } from './boards.service';

const mockBoard = {
  id: 'board-1',
  orgId: 'org-1',
  name: 'Feature Requests',
  slug: 'feature-requests',
  visibility: 'PUBLIC' as const,
  createdAt: new Date(),
};

describe('BoardsService', () => {
  let service: BoardsService;
  let prisma: {
    board: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    organization: { findUnique: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      board: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      organization: { findUnique: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [BoardsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(BoardsService);
  });

  describe('createBoard', () => {
    it('slug çakışmıyorsa slugify edilmiş slug ile board oluşturur', async () => {
      prisma.board.findUnique.mockResolvedValue(null); // slug org içinde boşta
      prisma.board.create.mockResolvedValue(mockBoard);

      const result = await service.createBoard('org-1', {
        name: 'Feature Requests',
      });

      expect(prisma.board.findUnique).toHaveBeenCalledWith({
        where: { orgId_slug: { orgId: 'org-1', slug: 'feature-requests' } },
      });
      expect(prisma.board.create).toHaveBeenCalledWith({
        data: {
          orgId: 'org-1',
          name: 'Feature Requests',
          slug: 'feature-requests',
          visibility: undefined,
        },
      });
      expect(result).toEqual(mockBoard);
    });

    it('slug aynı org içinde çakışıyorsa -2, -3... ekleyerek benzersizleştirir', async () => {
      prisma.board.findUnique
        .mockResolvedValueOnce(mockBoard) // 'feature-requests' dolu
        .mockResolvedValueOnce(null); // 'feature-requests-2' boşta
      prisma.board.create.mockResolvedValue({
        ...mockBoard,
        slug: 'feature-requests-2',
      });

      const result = await service.createBoard('org-1', {
        name: 'Feature Requests',
      });

      expect(prisma.board.create).toHaveBeenCalledWith({
        data: {
          orgId: 'org-1',
          name: 'Feature Requests',
          slug: 'feature-requests-2',
          visibility: undefined,
        },
      });
      expect(result.slug).toBe('feature-requests-2');
    });

    it('generateUniqueSlug ile create arasındaki yarışta DB unique constraint hatasını ConflictException olarak sarmalar', async () => {
      prisma.board.findUnique.mockResolvedValue(null);
      prisma.board.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(
        service.createBoard('org-1', { name: 'Feature Requests' }),
      ).rejects.toThrow(ConflictException);
    });

    it("FREE plan board limitine ULAŞMIŞ bir org'da PlanLimitExceededException fırlatır, board oluşturmaz", async () => {
      prisma.organization.findUnique.mockResolvedValue({
        plan: 'FREE',
        _count: { boards: 1 }, // PLAN_LIMITS.FREE.maxBoards
      });

      await expect(
        service.createBoard('org-1', { name: 'Second Board' }),
      ).rejects.toThrow(PlanLimitExceededException);
      expect(prisma.board.create).not.toHaveBeenCalled();
    });

    it("PRO plan org'da board sayısı ne olursa olsun limit kontrolüne takılmaz", async () => {
      prisma.organization.findUnique.mockResolvedValue({
        plan: 'PRO',
        _count: { boards: 25 },
      });
      prisma.board.findUnique.mockResolvedValue(null);
      prisma.board.create.mockResolvedValue(mockBoard);

      await expect(
        service.createBoard('org-1', { name: 'Feature Requests' }),
      ).resolves.toEqual(mockBoard);
    });
  });

  describe('listBoards', () => {
    it("org'a ait board'ları oluşturulma sırasıyla döner", async () => {
      prisma.board.findMany.mockResolvedValue([mockBoard]);

      const result = await service.listBoards('org-1');

      expect(prisma.board.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([mockBoard]);
    });
  });

  describe('getBoard', () => {
    it('board bulunursa ve org sahibiyse döner', async () => {
      prisma.board.findUnique.mockResolvedValue(mockBoard);

      const result = await service.getBoard('org-1', 'board-1');

      expect(result).toEqual(mockBoard);
    });

    it('board yoksa NotFoundException fırlatır', async () => {
      prisma.board.findUnique.mockResolvedValue(null);

      await expect(service.getBoard('org-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("board başka bir org'a aitse NotFoundException fırlatır (izolasyon — var olduğu bile sızmaz)", async () => {
      prisma.board.findUnique.mockResolvedValue({
        ...mockBoard,
        orgId: 'other-org',
      });

      await expect(service.getBoard('org-1', 'board-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateBoard', () => {
    it('sadece verilen alanları günceller', async () => {
      prisma.board.findUnique.mockResolvedValue(mockBoard);
      prisma.board.update.mockResolvedValue({
        ...mockBoard,
        visibility: 'PRIVATE',
      });

      const result = await service.updateBoard('org-1', 'board-1', {
        visibility: 'PRIVATE' as const,
      });

      expect(prisma.board.update).toHaveBeenCalledWith({
        where: { id: 'board-1' },
        data: { visibility: 'PRIVATE' },
      });
      expect(result.visibility).toBe('PRIVATE');
    });

    it("başka org'un board'unu güncellemeye çalışınca NotFoundException fırlatır", async () => {
      prisma.board.findUnique.mockResolvedValue({
        ...mockBoard,
        orgId: 'other-org',
      });

      await expect(
        service.updateBoard('org-1', 'board-1', { name: 'X' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.board.update).not.toHaveBeenCalled();
    });
  });

  describe('getPublicBoard', () => {
    it("org ve board slug'ı eşleşen PUBLIC bir board'u döner", async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.board.findUnique.mockResolvedValue(mockBoard);

      const result = await service.getPublicBoard(
        'board-test-org',
        'feature-requests',
      );

      expect(prisma.organization.findUnique).toHaveBeenCalledWith({
        where: { slug: 'board-test-org' },
      });
      expect(prisma.board.findUnique).toHaveBeenCalledWith({
        where: { orgId_slug: { orgId: 'org-1', slug: 'feature-requests' } },
      });
      expect(result).toEqual(mockBoard);
    });

    it('org slug bulunamazsa NotFoundException fırlatır', async () => {
      prisma.organization.findUnique.mockResolvedValue(null);

      await expect(
        service.getPublicBoard('missing-org', 'feature-requests'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.board.findUnique).not.toHaveBeenCalled();
    });

    it('board bulunamazsa NotFoundException fırlatır', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.board.findUnique.mockResolvedValue(null);

      await expect(
        service.getPublicBoard('board-test-org', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it('board PRIVATE ise NotFoundException fırlatır (var olduğu bile sızdırılmaz)', async () => {
      prisma.organization.findUnique.mockResolvedValue({ id: 'org-1' });
      prisma.board.findUnique.mockResolvedValue({
        ...mockBoard,
        visibility: 'PRIVATE',
      });

      await expect(
        service.getPublicBoard('board-test-org', 'feature-requests'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('deleteBoard', () => {
    it("board org'a aitse siler", async () => {
      prisma.board.findUnique.mockResolvedValue(mockBoard);
      prisma.board.delete.mockResolvedValue(mockBoard);

      await service.deleteBoard('org-1', 'board-1');

      expect(prisma.board.delete).toHaveBeenCalledWith({
        where: { id: 'board-1' },
      });
    });

    it("başka org'un board'unu silmeye çalışınca NotFoundException fırlatır ve silmez", async () => {
      prisma.board.findUnique.mockResolvedValue({
        ...mockBoard,
        orgId: 'other-org',
      });

      await expect(service.deleteBoard('org-1', 'board-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.board.delete).not.toHaveBeenCalled();
    });
  });
});
