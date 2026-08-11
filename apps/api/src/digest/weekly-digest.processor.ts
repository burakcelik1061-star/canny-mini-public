import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EMAIL_PROVIDER } from '../email/email-provider.interface';
import type { EmailProvider } from '../email/email-provider.interface';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const TOP_VOTED_LIMIT = 5;

// Faz 5.3 — "her org için haftalık bir özet" (prompt-library). Alıcı
// kitlesi bilinçli olarak org'un OWNER|ADMIN üyeleri: digest roadmap'i
// yönetenlere hitap ediyor ("bu hafta neler oldu, nereye bakmalısın"),
// 5.2'nin bildirimlerinin aksine (o, oy veren/yorum yapan SON kullanıcıya
// gidiyordu — burada tam tersi yön).
@Processor('weekly-digest')
export class WeeklyDigestProcessor extends WorkerHost {
  private readonly logger = new Logger(WeeklyDigestProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {
    super();
  }

  async process(): Promise<{ orgsSent: number; orgsSkipped: number }> {
    const since = new Date(Date.now() - WEEK_MS);

    const orgs = await this.prisma.organization.findMany({
      select: {
        id: true,
        name: true,
        boards: { select: { id: true } },
        members: {
          where: { role: { in: ['OWNER', 'ADMIN'] } },
          select: { user: { select: { email: true, name: true } } },
        },
      },
    });

    let orgsSent = 0;
    let orgsSkipped = 0;

    for (const org of orgs) {
      const boardIds = org.boards.map((b) => b.id);
      if (boardIds.length === 0) {
        orgsSkipped++;
        continue;
      }

      const newPosts = await this.prisma.post.findMany({
        where: {
          boardId: { in: boardIds },
          mergedIntoPostId: null,
          createdAt: { gte: since },
        },
        select: { id: true, title: true },
        orderBy: { createdAt: 'desc' },
      });

      // "En çok oy alanlar" — tüm zamanların değil BU HAFTA atılan oylara
      // göre (Vote.createdAt) sıralanıyor, ki digest her hafta farklı bir
      // "bu hafta yükselenler" listesi göstersin; sabit eski bir post'un
      // toplam oyu yüksek diye her hafta tekrar listelenmesi bir "haftalık"
      // özetin amacına aykırı olurdu.
      const topVotedGroups = await this.prisma.vote.groupBy({
        by: ['postId'],
        where: {
          createdAt: { gte: since },
          post: { boardId: { in: boardIds }, mergedIntoPostId: null },
        },
        _count: { postId: true },
        orderBy: { _count: { postId: 'desc' } },
        take: TOP_VOTED_LIMIT,
      });

      if (newPosts.length === 0 && topVotedGroups.length === 0) {
        // Bu hafta hiç hareket yoksa gürültü bir email atmıyoruz.
        orgsSkipped++;
        continue;
      }

      const topVotedPosts =
        topVotedGroups.length > 0
          ? await this.prisma.post.findMany({
              where: { id: { in: topVotedGroups.map((g) => g.postId) } },
              select: { id: true, title: true },
            })
          : [];
      const voteCountByPostId = new Map(
        topVotedGroups.map((g) => [g.postId, g._count.postId]),
      );
      const topVotedLines = topVotedPosts
        .sort(
          (a, b) =>
            (voteCountByPostId.get(b.id) ?? 0) -
            (voteCountByPostId.get(a.id) ?? 0),
        )
        .map((p) => `  - ${p.title} (${voteCountByPostId.get(p.id)} oy)`);

      const body = [
        `Merhaba,`,
        ``,
        `"${org.name}" için haftalık özet:`,
        ``,
        `Yeni öneriler (${newPosts.length}):`,
        ...(newPosts.length > 0
          ? newPosts.map((p) => `  - ${p.title}`)
          : ['  (bu hafta yeni öneri yok)']),
        ``,
        `Bu hafta en çok oy alanlar (${topVotedLines.length}):`,
        ...(topVotedLines.length > 0
          ? topVotedLines
          : ['  (bu hafta oy verilmiş bir post yok)']),
      ].join('\n');

      for (const { user } of org.members) {
        await this.emailProvider.send({
          to: user.email,
          subject: `${org.name} — haftalık özet`,
          body,
        });
      }
      orgsSent++;
    }

    this.logger.log(
      `Haftalık digest işlendi: ${orgsSent} org'a gönderildi, ${orgsSkipped} org (hareketsiz/board'suz) atlandı`,
    );
    return { orgsSent, orgsSkipped };
  }
}
