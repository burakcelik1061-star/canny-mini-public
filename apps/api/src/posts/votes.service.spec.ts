import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { VotesService } from './votes.service';

describe('VotesService', () => {
  let service: VotesService;
  let prisma: {
    vote: { create: jest.Mock; deleteMany: jest.Mock; count: jest.Mock };
    $transaction: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      vote: { create: jest.fn(), deleteMany: jest.fn(), count: jest.fn() },
      // Interactive $transaction: callback'e tx olarak prisma mock'unun
      // kendisini geçiyoruz — böylece testlerdeki `prisma.vote.*` assertion'ları
      // tx içindeki çağrıları görüyor (mutasyon + count aynı transaction'da).
      $transaction: jest.fn((cb: (tx: unknown) => unknown) => cb(prisma)),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [VotesService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(VotesService);
  });

  describe('addVote', () => {
    it('oy oluşturur ve güncel voteCount döner', async () => {
      prisma.vote.create.mockResolvedValue({});
      prisma.vote.count.mockResolvedValue(4);

      const result = await service.addVote('post-1', 'user-1');

      expect(prisma.vote.create).toHaveBeenCalledWith({
        data: { postId: 'post-1', userId: 'user-1' },
      });
      expect(prisma.vote.count).toHaveBeenCalledWith({
        where: { postId: 'post-1' },
      });
      expect(result).toEqual({ voteCount: 4 });
    });

    it("aynı kullanıcı aynı post'a tekrar oy vermeye çalışırsa ConflictException fırlatır", async () => {
      prisma.vote.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(service.addVote('post-1', 'user-1')).rejects.toThrow(
        ConflictException,
      );
      expect(prisma.vote.count).not.toHaveBeenCalled();
    });
  });

  describe('removeVote', () => {
    it('oy varsa siler ve güncel voteCount döner', async () => {
      prisma.vote.deleteMany.mockResolvedValue({ count: 1 });
      prisma.vote.count.mockResolvedValue(2);

      const result = await service.removeVote('post-1', 'user-1');

      expect(prisma.vote.deleteMany).toHaveBeenCalledWith({
        where: { postId: 'post-1', userId: 'user-1' },
      });
      expect(result).toEqual({ voteCount: 2 });
    });

    it('daha önce oy verilmemişse NotFoundException fırlatır', async () => {
      prisma.vote.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.removeVote('post-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.vote.count).not.toHaveBeenCalled();
    });
  });
});
