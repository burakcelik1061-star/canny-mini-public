import { getQueueToken } from '@nestjs/bullmq';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationsService } from './notifications.service';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let queue: { add: jest.Mock };
  let prisma: {
    notification: { findMany: jest.Mock; updateMany: jest.Mock };
  };

  beforeEach(async () => {
    queue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    prisma = {
      notification: { findMany: jest.fn(), updateMany: jest.fn() },
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        {
          provide: getQueueToken('status-change-notifications'),
          useValue: queue,
        },
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = moduleRef.get(NotificationsService);
  });

  it("status değişikliği job'ını doğru verilerle kuyruğa ekler", async () => {
    await service.enqueueStatusChangeNotification(
      'post-1',
      'UNDER_REVIEW',
      'PLANNED',
    );

    expect(queue.add).toHaveBeenCalledWith('status-change', {
      postId: 'post-1',
      previousStatus: 'UNDER_REVIEW',
      newStatus: 'PLANNED',
    });
  });

  describe('listForUser', () => {
    it('kullanıcının bildirimlerini en yeni önce, sınırlı sayıda döner', async () => {
      const rows = [{ id: 'notif-1', message: 'test', read: false }];
      prisma.notification.findMany.mockResolvedValue(rows);

      const result = await service.listForUser('user-1');

      expect(prisma.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1' },
          orderBy: { createdAt: 'desc' },
          take: 50,
        }),
      );
      expect(result).toBe(rows);
    });
  });

  describe('markAsRead', () => {
    it('kullanıcıya ait bildirimi okundu işaretler', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.markAsRead('user-1', 'notif-1'),
      ).resolves.toBeUndefined();

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { id: 'notif-1', userId: 'user-1' },
        data: { read: true },
      });
    });

    it('bildirim yoksa veya başka bir kullanıcıya aitse NotFoundException fırlatır (izolasyon)', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.markAsRead('user-1', 'baskasinin-bildirimi'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('markAllAsRead', () => {
    it('kullanıcının tüm okunmamış bildirimlerini okundu işaretler', async () => {
      prisma.notification.updateMany.mockResolvedValue({ count: 3 });

      await service.markAllAsRead('user-1');

      expect(prisma.notification.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1', read: false },
        data: { read: true },
      });
    });
  });
});
