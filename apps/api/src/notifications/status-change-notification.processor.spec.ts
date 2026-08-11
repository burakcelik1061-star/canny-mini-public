import { Job } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  StatusChangeJobData,
  StatusChangeNotificationProcessor,
} from './status-change-notification.processor';

describe('StatusChangeNotificationProcessor', () => {
  let processor: StatusChangeNotificationProcessor;
  let prisma: {
    post: { findUnique: jest.Mock };
    notification: { create: jest.Mock };
  };
  let emailProvider: { send: jest.Mock };

  beforeEach(() => {
    prisma = {
      post: { findUnique: jest.fn() },
      notification: { create: jest.fn().mockResolvedValue(undefined) },
    };
    emailProvider = { send: jest.fn().mockResolvedValue(undefined) };

    processor = new StatusChangeNotificationProcessor(
      prisma as unknown as PrismaService,
      emailProvider,
    );
  });

  const makeJob = (data: StatusChangeJobData) =>
    ({ data }) as unknown as Job<StatusChangeJobData>;

  it('oy verenlere VE yorum yapanlara (kesişimde dedup ile) email gönderir', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      title: 'Dark mode ekle',
      votes: [
        { user: { id: 'user-1', email: 'a@x.com', name: 'A' } },
        { user: { id: 'user-2', email: 'b@x.com', name: 'B' } },
      ],
      comments: [
        // user-1 hem oy vermiş hem yorum yapmış — tek email almalı
        { author: { id: 'user-1', email: 'a@x.com', name: 'A' } },
        { author: { id: 'user-3', email: 'c@x.com', name: 'C' } },
      ],
    });

    const result = await processor.process(
      makeJob({
        postId: 'post-1',
        previousStatus: 'UNDER_REVIEW',
        newStatus: 'PLANNED',
      }),
    );

    expect(emailProvider.send).toHaveBeenCalledTimes(3);
    expect(result.recipientCount).toBe(3);
    const recipients = emailProvider.send.mock.calls.map(
      ([msg]: [{ to: string }]) => msg.to,
    );
    expect(recipients.sort()).toEqual(['a@x.com', 'b@x.com', 'c@x.com']);

    // 5.4 — her alıcı için email'in yanında bir in-app Notification satırı
    // da oluşturulmalı (userId'ye göre dedup edilmiş, yine 3 alıcı).
    expect(prisma.notification.create).toHaveBeenCalledTimes(3);
    const notifiedUserIds = prisma.notification.create.mock.calls.map(
      ([args]: [{ data: { userId: string } }]) => args.data.userId,
    );
    expect(notifiedUserIds.sort()).toEqual(['user-1', 'user-2', 'user-3']);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: 'user-1',
        postId: 'post-1',
        message: '"Dark mode ekle" artık "Planlandı" durumunda.',
      },
    });
  });

  it('post bulunamazsa (silinmiş/erişilemez) email göndermeden sessizce döner', async () => {
    prisma.post.findUnique.mockResolvedValue(null);

    const result = await processor.process(
      makeJob({
        postId: 'missing',
        previousStatus: 'UNDER_REVIEW',
        newStatus: 'PLANNED',
      }),
    );

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
    expect(result.recipientCount).toBe(0);
  });

  it('oy veren/yorum yapan yoksa hiç email göndermez', async () => {
    prisma.post.findUnique.mockResolvedValue({
      id: 'post-1',
      title: 'Kimsenin oy vermediği post',
      votes: [],
      comments: [],
    });

    const result = await processor.process(
      makeJob({
        postId: 'post-1',
        previousStatus: 'UNDER_REVIEW',
        newStatus: 'CLOSED',
      }),
    );

    expect(emailProvider.send).not.toHaveBeenCalled();
    expect(result.recipientCount).toBe(0);
  });
});
