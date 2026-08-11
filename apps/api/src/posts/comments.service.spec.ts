import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { CommentsService } from './comments.service';

const mockComment = {
  id: 'comment-1',
  postId: 'post-1',
  authorId: 'user-1',
  body: 'Buna da bayılırım',
  isOfficial: false,
  createdAt: new Date(),
};

describe('CommentsService', () => {
  let service: CommentsService;
  let prisma: { comment: { create: jest.Mock; findMany: jest.Mock } };

  beforeEach(async () => {
    prisma = { comment: { create: jest.fn(), findMany: jest.fn() } };

    const moduleRef = await Test.createTestingModule({
      providers: [
        CommentsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(CommentsService);
  });

  describe('createComment', () => {
    it('body trim edilerek isOfficial=false ile yorum oluşturur', async () => {
      prisma.comment.create.mockResolvedValue(mockComment);

      const result = await service.createComment('post-1', 'user-1', {
        body: '  Buna da bayılırım  ',
      });

      expect(prisma.comment.create).toHaveBeenCalledWith({
        data: {
          postId: 'post-1',
          authorId: 'user-1',
          body: 'Buna da bayılırım',
          isOfficial: false,
        },
        omit: { authorId: true },
      });
      expect(result).toEqual(mockComment);
    });

    it('isOfficial=true verilirse (3.4, admin yanıtı) yorum resmi olarak oluşturulur', async () => {
      prisma.comment.create.mockResolvedValue({
        ...mockComment,
        isOfficial: true,
      });

      const result = await service.createComment(
        'post-1',
        'admin-1',
        { body: 'Bu özellik bir sonraki sürümde geliyor' },
        true,
      );

      expect(prisma.comment.create).toHaveBeenCalledWith({
        data: {
          postId: 'post-1',
          authorId: 'admin-1',
          body: 'Bu özellik bir sonraki sürümde geliyor',
          isOfficial: true,
        },
        omit: { authorId: true },
      });
      expect(result.isOfficial).toBe(true);
    });
  });

  describe('listCommentsForPost', () => {
    it("post'a ait yorumları kronolojik sırayla (en eskiden en yeniye) döner", async () => {
      prisma.comment.findMany.mockResolvedValue([mockComment]);

      const result = await service.listCommentsForPost('post-1');

      expect(prisma.comment.findMany).toHaveBeenCalledWith({
        where: { postId: 'post-1' },
        omit: { authorId: true },
        orderBy: { createdAt: 'asc' },
      });
      expect(result).toEqual([mockComment]);
    });
  });
});
