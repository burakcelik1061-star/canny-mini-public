import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { isPostStatus, PostsService } from './posts.service';

describe('isPostStatus', () => {
  it('geçerli bir PostStatus değeri için true döner', () => {
    expect(isPostStatus('PLANNED')).toBe(true);
  });

  it('bilinmeyen bir string, boş değer veya string olmayan bir değer için false döner', () => {
    expect(isPostStatus('planned')).toBe(false); // casing yanlış
    expect(isPostStatus('NOT_A_STATUS')).toBe(false);
    expect(isPostStatus(undefined)).toBe(false);
    expect(isPostStatus(42)).toBe(false);
  });
});

const mockPost = {
  id: 'post-1',
  boardId: 'board-1',
  authorId: 'user-1',
  title: 'Dark mode please',
  description: 'Eyes hurt at night',
  status: 'UNDER_REVIEW' as const,
  mergedIntoPostId: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  tags: [] as { id: string; name: string; color: string }[],
};

const POST_LIST_INCLUDE = { _count: { select: { votes: true } }, tags: true };

describe('PostsService', () => {
  let service: PostsService;
  let prisma: {
    post: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
    };
    vote: {
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
    $queryRaw: jest.Mock;
  };

  beforeEach(async () => {
    prisma = {
      post: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      vote: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      // mergePost transaction'ının başındaki FOR UPDATE kilidi (tx.$queryRaw) —
      // mock'ta sadece çözülmesi yeterli (dönüşü kullanılmıyor).
      $queryRaw: jest.fn().mockResolvedValue([]),
      // Transaction'ı test etmek için: gerçek bir DB transaction'ı açmak
      // yerine callback'e prisma'nın kendisini (tx olarak) geçiriyoruz —
      // mock'ların hepsi zaten aynı obje üzerinde, gerçek bir izolasyona
      // ihtiyaç yok, sadece çağrı sırasının/argümanların doğruluğu test
      // ediliyor.
      $transaction: jest.fn((callback: (tx: unknown) => unknown) =>
        callback(prisma),
      ),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [PostsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = moduleRef.get(PostsService);
  });

  describe('createPost', () => {
    it('title/description trim edilerek UNDER_REVIEW status ile post oluşturur', async () => {
      prisma.post.create.mockResolvedValue(mockPost);

      const result = await service.createPost('board-1', 'user-1', {
        title: '  Dark mode please  ',
        description: '  Eyes hurt at night  ',
      });

      expect(prisma.post.create).toHaveBeenCalledWith({
        data: {
          boardId: 'board-1',
          authorId: 'user-1',
          title: 'Dark mode please',
          description: 'Eyes hurt at night',
        },
        omit: { authorId: true },
      });
      expect(result).toEqual({
        ...mockPost,
        voteCount: 0,
        hasVoted: false,
        tags: [],
      });
    });
  });

  describe('listPostsForBoard', () => {
    it("sort 'new' iken en yeniden en eskiye sıralar ve voteCount/hasVoted ekler", async () => {
      prisma.post.findMany.mockResolvedValue([
        { ...mockPost, _count: { votes: 3 } },
      ]);

      const result = await service.listPostsForBoard('board-1', {
        sort: 'new',
      });

      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: { boardId: 'board-1', mergedIntoPostId: null },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
      expect(prisma.vote.findMany).not.toHaveBeenCalled();
      expect(result).toEqual([{ ...mockPost, voteCount: 3, hasVoted: false }]);
    });

    it("sort 'top' iken oy sayısına göre (eşitlikte en yeni) sıralar", async () => {
      prisma.post.findMany.mockResolvedValue([
        { ...mockPost, _count: { votes: 5 } },
      ]);

      await service.listPostsForBoard('board-1', { sort: 'top' });

      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: { boardId: 'board-1', mergedIntoPostId: null },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
        orderBy: [{ votes: { _count: 'desc' } }, { createdAt: 'desc' }],
        take: 50,
        skip: 0,
      });
    });

    it("viewerUserId verilirse sadece o kullanıcının oy verdiği post'larda hasVoted true olur", async () => {
      prisma.post.findMany.mockResolvedValue([
        { ...mockPost, id: 'post-1', _count: { votes: 2 } },
        { ...mockPost, id: 'post-2', _count: { votes: 0 } },
      ]);
      prisma.vote.findMany.mockResolvedValue([{ postId: 'post-1' }]);

      const result = await service.listPostsForBoard('board-1', {
        sort: 'new',
        viewerUserId: 'user-1',
      });

      expect(prisma.vote.findMany).toHaveBeenCalledWith({
        where: { postId: { in: ['post-1', 'post-2'] }, userId: 'user-1' },
        select: { postId: true },
      });
      expect(result[0].hasVoted).toBe(true);
      expect(result[1].hasVoted).toBe(false);
    });

    it('status verilirse where filtresine eklenir', async () => {
      prisma.post.findMany.mockResolvedValue([]);

      await service.listPostsForBoard('board-1', {
        sort: 'new',
        status: 'PLANNED',
      });

      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: {
          boardId: 'board-1',
          mergedIntoPostId: null,
          status: 'PLANNED',
        },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('search verilirse başlık/açıklamada case-insensitive OR araması yapılır', async () => {
      prisma.post.findMany.mockResolvedValue([]);

      await service.listPostsForBoard('board-1', {
        sort: 'new',
        search: 'dark',
      });

      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: {
          boardId: 'board-1',
          mergedIntoPostId: null,
          OR: [
            { title: { contains: 'dark', mode: 'insensitive' } },
            { description: { contains: 'dark', mode: 'insensitive' } },
          ],
        },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it("status ve search birlikte verilirse ikisi de where'e eklenir", async () => {
      prisma.post.findMany.mockResolvedValue([]);

      await service.listPostsForBoard('board-1', {
        sort: 'new',
        status: 'CLOSED',
        search: 'export',
      });

      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: {
          boardId: 'board-1',
          mergedIntoPostId: null,
          status: 'CLOSED',
          OR: [
            { title: { contains: 'export', mode: 'insensitive' } },
            { description: { contains: 'export', mode: 'insensitive' } },
          ],
        },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });

    it('tagId verilirse where filtresine eklenir', async () => {
      prisma.post.findMany.mockResolvedValue([]);

      await service.listPostsForBoard('board-1', {
        sort: 'new',
        tagId: 'tag-1',
      });

      expect(prisma.post.findMany).toHaveBeenCalledWith({
        where: {
          boardId: 'board-1',
          mergedIntoPostId: null,
          tags: { some: { id: 'tag-1' } },
        },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
        orderBy: { createdAt: 'desc' },
        take: 50,
        skip: 0,
      });
    });
  });

  describe('getPostDetail', () => {
    it("post board'a aitse voteCount/hasVoted=false (viewer yok) ile döner", async () => {
      prisma.post.findUnique.mockResolvedValue({
        ...mockPost,
        _count: { votes: 2 },
      });

      const result = await service.getPostDetail('board-1', 'post-1');

      expect(prisma.post.findUnique).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
      });
      expect(prisma.vote.findUnique).not.toHaveBeenCalled();
      expect(result).toEqual({ ...mockPost, voteCount: 2, hasVoted: false });
    });

    it('viewerUserId verilirse ve oy verdiyse hasVoted=true döner', async () => {
      prisma.post.findUnique.mockResolvedValue({
        ...mockPost,
        _count: { votes: 2 },
      });
      prisma.vote.findUnique.mockResolvedValue({ id: 'vote-1' });

      const result = await service.getPostDetail('board-1', 'post-1', 'user-1');

      expect(prisma.vote.findUnique).toHaveBeenCalledWith({
        where: { postId_userId: { postId: 'post-1', userId: 'user-1' } },
      });
      expect(result.hasVoted).toBe(true);
    });

    it('post yoksa NotFoundException fırlatır', async () => {
      prisma.post.findUnique.mockResolvedValue(null);

      await expect(service.getPostDetail('board-1', 'missing')).rejects.toThrow(
        NotFoundException,
      );
    });

    it("post başka bir board'a aitse NotFoundException fırlatır (izolasyon)", async () => {
      prisma.post.findUnique.mockResolvedValue({
        ...mockPost,
        boardId: 'other-board',
        _count: { votes: 0 },
      });

      await expect(service.getPostDetail('board-1', 'post-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('assertPostInBoard', () => {
    it("post board'a aitse sessizce döner", async () => {
      prisma.post.findUnique.mockResolvedValue({ boardId: 'board-1' });

      await expect(
        service.assertPostInBoard('board-1', 'post-1'),
      ).resolves.toBeUndefined();
    });

    it('post yoksa NotFoundException fırlatır', async () => {
      prisma.post.findUnique.mockResolvedValue(null);

      await expect(
        service.assertPostInBoard('board-1', 'missing'),
      ).rejects.toThrow(NotFoundException);
    });

    it("post başka bir board'a aitse NotFoundException fırlatır (izolasyon)", async () => {
      prisma.post.findUnique.mockResolvedValue({ boardId: 'other-board' });

      await expect(
        service.assertPostInBoard('board-1', 'post-1'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('updatePostStatus', () => {
    it("post board'a aitse status'ü günceller ve eski status'ü de döner", async () => {
      prisma.post.findUnique.mockResolvedValue({
        boardId: 'board-1',
        status: 'UNDER_REVIEW',
      });
      prisma.post.update.mockResolvedValue({ ...mockPost, status: 'PLANNED' });

      const result = await service.updatePostStatus(
        'board-1',
        'post-1',
        'PLANNED',
      );

      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { status: 'PLANNED' },
      });
      expect(result.post.status).toBe('PLANNED');
      expect(result.previousStatus).toBe('UNDER_REVIEW');
    });

    it('post yoksa NotFoundException fırlatır, update çağrılmaz', async () => {
      prisma.post.findUnique.mockResolvedValue(null);

      await expect(
        service.updatePostStatus('board-1', 'missing', 'PLANNED'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.post.update).not.toHaveBeenCalled();
    });

    it("post başka bir board'a aitse NotFoundException fırlatır, update çağrılmaz (izolasyon)", async () => {
      prisma.post.findUnique.mockResolvedValue({ boardId: 'other-board' });

      await expect(
        service.updatePostStatus('board-1', 'post-1', 'PLANNED'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.post.update).not.toHaveBeenCalled();
    });
  });

  describe('setPostTags', () => {
    it("post board'a aitse tag kümesini `set` ile değiştirir", async () => {
      prisma.post.findUnique.mockResolvedValue({ boardId: 'board-1' });
      prisma.post.update.mockResolvedValue({
        ...mockPost,
        tags: [{ id: 'tag-1', name: 'bug', color: '#f00' }],
        _count: { votes: 0 },
      });

      const result = await service.setPostTags('board-1', 'post-1', ['tag-1']);

      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { tags: { set: [{ id: 'tag-1' }] } },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
      });
      expect(result.tags).toEqual([
        { id: 'tag-1', name: 'bug', color: '#f00' },
      ]);
    });

    it("boş dizi verilirse post'un tüm tag'lerini kaldırır", async () => {
      prisma.post.findUnique.mockResolvedValue({ boardId: 'board-1' });
      prisma.post.update.mockResolvedValue({
        ...mockPost,
        tags: [],
        _count: { votes: 0 },
      });

      await service.setPostTags('board-1', 'post-1', []);

      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'post-1' },
        data: { tags: { set: [] } },
        omit: { authorId: true },
        include: POST_LIST_INCLUDE,
      });
    });

    it('post yoksa NotFoundException fırlatır, update çağrılmaz', async () => {
      prisma.post.findUnique.mockResolvedValue(null);

      await expect(
        service.setPostTags('board-1', 'missing', ['tag-1']),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.post.update).not.toHaveBeenCalled();
    });
  });

  describe('mergePost', () => {
    it("source'un oylarını target'a taşır ve source'u mergedIntoPostId ile işaretler", async () => {
      prisma.post.findUnique.mockImplementation(({ where: { id } }) =>
        Promise.resolve(
          id === 'source'
            ? { ...mockPost, id: 'source', mergedIntoPostId: null }
            : { ...mockPost, id: 'target', mergedIntoPostId: null },
        ),
      );
      prisma.vote.findMany.mockResolvedValue([
        { id: 'vote-1', postId: 'source', userId: 'user-a' },
        { id: 'vote-2', postId: 'source', userId: 'user-b' },
      ]);
      // user-a target'a da oy vermiş — çakışma, source'daki oy silinmeli.
      // user-b sadece source'a oy vermiş — target'a taşınmalı.
      prisma.vote.findUnique.mockImplementation(
        (args: { where: { postId_userId: { userId: string } } }) =>
          Promise.resolve(
            args.where.postId_userId.userId === 'user-a'
              ? { id: 'existing-vote' }
              : null,
          ),
      );
      prisma.post.update.mockResolvedValue({
        ...mockPost,
        id: 'source',
        mergedIntoPostId: 'target',
      });

      const result = await service.mergePost('board-1', 'source', 'target');

      expect(prisma.vote.delete).toHaveBeenCalledWith({
        where: { id: 'vote-1' },
      });
      expect(prisma.vote.update).toHaveBeenCalledWith({
        where: { id: 'vote-2' },
        data: { postId: 'target' },
      });
      expect(prisma.post.update).toHaveBeenCalledWith({
        where: { id: 'source' },
        data: { mergedIntoPostId: 'target' },
      });
      expect(result.mergedIntoPostId).toBe('target');
    });

    it('kaynak ve hedef aynıysa BadRequestException fırlatır (400)', async () => {
      await expect(
        service.mergePost('board-1', 'post-1', 'post-1'),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.post.findUnique).not.toHaveBeenCalled();
    });

    it("source başka bir board'a aitse NotFoundException fırlatır (izolasyon)", async () => {
      prisma.post.findUnique.mockImplementation(({ where: { id } }) =>
        Promise.resolve(
          id === 'source'
            ? { ...mockPost, id: 'source', boardId: 'other-board' }
            : { ...mockPost, id: 'target' },
        ),
      );

      await expect(
        service.mergePost('board-1', 'source', 'target'),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.post.update).not.toHaveBeenCalled();
    });

    it('target bulunamazsa NotFoundException fırlatır', async () => {
      prisma.post.findUnique.mockImplementation(({ where: { id } }) =>
        Promise.resolve(id === 'source' ? { ...mockPost, id: 'source' } : null),
      );

      await expect(
        service.mergePost('board-1', 'source', 'target'),
      ).rejects.toThrow(NotFoundException);
    });

    it('source zaten merge edilmişse ConflictException fırlatır (409)', async () => {
      prisma.post.findUnique.mockImplementation(({ where: { id } }) =>
        Promise.resolve(
          id === 'source'
            ? { ...mockPost, id: 'source', mergedIntoPostId: 'other' }
            : { ...mockPost, id: 'target' },
        ),
      );

      await expect(
        service.mergePost('board-1', 'source', 'target'),
      ).rejects.toThrow(ConflictException);
      expect(prisma.post.update).not.toHaveBeenCalled();
    });
  });
});
