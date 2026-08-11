import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TagsService } from './tags.service';

const mockTag = {
  id: 'tag-1',
  orgId: 'org-1',
  name: 'bug',
  color: '#71717a',
  createdAt: new Date(),
};

describe('TagsService', () => {
  let service: TagsService;
  let prisma: {
    tag: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
      count: jest.Mock;
    };
  };

  beforeEach(async () => {
    prisma = {
      tag: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
        count: jest.fn(),
      },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [TagsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(TagsService);
  });

  describe('createTag', () => {
    it('isim trim edilerek oluşturur', async () => {
      prisma.tag.create.mockResolvedValue(mockTag);

      const result = await service.createTag('org-1', { name: '  bug  ' });

      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: { orgId: 'org-1', name: 'bug' },
      });
      expect(result).toEqual(mockTag);
    });

    it('color verilirse data içine eklenir', async () => {
      prisma.tag.create.mockResolvedValue({ ...mockTag, color: '#ff0000' });

      await service.createTag('org-1', { name: 'bug', color: '#ff0000' });

      expect(prisma.tag.create).toHaveBeenCalledWith({
        data: { orgId: 'org-1', name: 'bug', color: '#ff0000' },
      });
    });

    it('aynı org içinde aynı isim varsa ConflictException fırlatır', async () => {
      prisma.tag.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique violation', {
          code: 'P2002',
          clientVersion: '6.19.3',
        }),
      );

      await expect(service.createTag('org-1', { name: 'bug' })).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('listTags', () => {
    it("org'un tag'lerini isme göre sıralı döner", async () => {
      prisma.tag.findMany.mockResolvedValue([mockTag]);

      const result = await service.listTags('org-1');

      expect(prisma.tag.findMany).toHaveBeenCalledWith({
        where: { orgId: 'org-1' },
        orderBy: { name: 'asc' },
      });
      expect(result).toEqual([mockTag]);
    });
  });

  describe('deleteTag', () => {
    it("tag org'a aitse siler", async () => {
      prisma.tag.findUnique.mockResolvedValue(mockTag);

      await service.deleteTag('org-1', 'tag-1');

      expect(prisma.tag.delete).toHaveBeenCalledWith({
        where: { id: 'tag-1' },
      });
    });

    it('tag yoksa NotFoundException fırlatır, delete çağrılmaz', async () => {
      prisma.tag.findUnique.mockResolvedValue(null);

      await expect(service.deleteTag('org-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.tag.delete).not.toHaveBeenCalled();
    });

    it("tag başka bir org'a aitse NotFoundException fırlatır (izolasyon)", async () => {
      prisma.tag.findUnique.mockResolvedValue({
        ...mockTag,
        orgId: 'other-org',
      });

      await expect(service.deleteTag('org-1', 'tag-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.tag.delete).not.toHaveBeenCalled();
    });
  });

  describe('assertTagsBelongToOrg', () => {
    it('boş dizi için hiçbir sorgu yapmadan döner', async () => {
      await expect(
        service.assertTagsBelongToOrg('org-1', []),
      ).resolves.toBeUndefined();
      expect(prisma.tag.count).not.toHaveBeenCalled();
    });

    it("tüm tag'ler org'a aitse sessizce döner", async () => {
      prisma.tag.count.mockResolvedValue(2);

      await expect(
        service.assertTagsBelongToOrg('org-1', ['tag-1', 'tag-2']),
      ).resolves.toBeUndefined();
      expect(prisma.tag.count).toHaveBeenCalledWith({
        where: { id: { in: ['tag-1', 'tag-2'] }, orgId: 'org-1' },
      });
    });

    it("bir tag başka org'a aitse ya da yoksa NotFoundException fırlatır", async () => {
      prisma.tag.count.mockResolvedValue(1); // 2 istendi, 1 bulundu

      await expect(
        service.assertTagsBelongToOrg('org-1', ['tag-1', 'tag-2']),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
