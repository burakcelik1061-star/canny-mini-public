import { PrismaService } from '../prisma/prisma.service';
import { WeeklyDigestProcessor } from './weekly-digest.processor';

describe('WeeklyDigestProcessor', () => {
  let processor: WeeklyDigestProcessor;
  let prisma: {
    organization: { findMany: jest.Mock };
    post: { findMany: jest.Mock };
    vote: { groupBy: jest.Mock };
  };
  let emailProvider: { send: jest.Mock };

  beforeEach(() => {
    prisma = {
      organization: { findMany: jest.fn() },
      post: { findMany: jest.fn() },
      vote: { groupBy: jest.fn() },
    };
    emailProvider = { send: jest.fn().mockResolvedValue(undefined) };

    processor = new WeeklyDigestProcessor(
      prisma as unknown as PrismaService,
      emailProvider,
    );
  });

  it("board'u olmayan bir org'u atlar", async () => {
    prisma.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Boardsuz Org', boards: [], members: [] },
    ]);

    const result = await processor.process();

    expect(result).toEqual({ orgsSent: 0, orgsSkipped: 1 });
    expect(prisma.post.findMany).not.toHaveBeenCalled();
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it('bu hafta hiç yeni post/oy yoksa org’u atlar (gürültü email yok)', async () => {
    prisma.organization.findMany.mockResolvedValue([
      {
        id: 'org-1',
        name: 'Sakin Org',
        boards: [{ id: 'board-1' }],
        members: [{ user: { email: 'owner@x.com', name: 'Owner' } }],
      },
    ]);
    prisma.post.findMany.mockResolvedValue([]);
    prisma.vote.groupBy.mockResolvedValue([]);

    const result = await processor.process();

    expect(result).toEqual({ orgsSent: 0, orgsSkipped: 1 });
    expect(emailProvider.send).not.toHaveBeenCalled();
  });

  it('yeni post + en çok oy alanları OWNER/ADMIN üyelerine gönderir', async () => {
    prisma.organization.findMany.mockResolvedValue([
      {
        id: 'org-1',
        name: 'Aktif Org',
        boards: [{ id: 'board-1' }],
        members: [
          { user: { email: 'owner@x.com', name: 'Owner' } },
          { user: { email: 'admin@x.com', name: 'Admin' } },
        ],
      },
    ]);
    prisma.post.findMany
      .mockResolvedValueOnce([{ id: 'post-1', title: 'Yeni öneri' }]) // newPosts
      .mockResolvedValueOnce([{ id: 'post-2', title: 'Popüler öneri' }]); // topVotedPosts
    prisma.vote.groupBy.mockResolvedValue([
      { postId: 'post-2', _count: { postId: 7 } },
    ]);

    const result = await processor.process();

    expect(result).toEqual({ orgsSent: 1, orgsSkipped: 0 });
    expect(emailProvider.send).toHaveBeenCalledTimes(2);
    const [msg] = emailProvider.send.mock.calls[0] as [
      { to: string; subject: string; body: string },
    ];
    expect(msg.to).toBe('owner@x.com');
    expect(msg.subject).toBe('Aktif Org — haftalık özet');
    expect(msg.body).toContain('Yeni öneri');
    expect(msg.body).toContain('Popüler öneri (7 oy)');
  });

  it('birden fazla org bağımsız değerlendirilir (biri atlanır, biri gönderilir)', async () => {
    prisma.organization.findMany.mockResolvedValue([
      { id: 'org-1', name: 'Boardsuz', boards: [], members: [] },
      {
        id: 'org-2',
        name: 'Aktif',
        boards: [{ id: 'board-2' }],
        members: [{ user: { email: 'owner2@x.com', name: 'Owner2' } }],
      },
    ]);
    prisma.post.findMany.mockResolvedValueOnce([
      { id: 'post-3', title: 'Tek yeni post' },
    ]);
    prisma.vote.groupBy.mockResolvedValue([]);

    const result = await processor.process();

    expect(result).toEqual({ orgsSent: 1, orgsSkipped: 1 });
    expect(emailProvider.send).toHaveBeenCalledTimes(1);
    expect(emailProvider.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'owner2@x.com' }),
    );
  });
});
