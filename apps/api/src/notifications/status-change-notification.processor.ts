import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Inject, Logger } from '@nestjs/common';
import { PostStatus } from '@prisma/client';
import { Job } from 'bullmq';
import { EMAIL_PROVIDER } from '../email/email-provider.interface';
import type { EmailProvider } from '../email/email-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { STATUS_LABELS } from './status-labels';

export interface StatusChangeJobData {
  postId: string;
  previousStatus: PostStatus;
  newStatus: PostStatus;
}

// Post'a oy veren VEYA yorum yapan her kullanıcıya (prompt-library 5.2'nin
// tanımı) bir bildirim gönderir — ikisinin kesişimindeki kullanıcı (hem oy
// verip hem yorum yapmış) tek email alır, `Map` kullanımı bu yüzden (userId
// anahtarlı — email'e göre değil, aynı email'i teorik olarak iki farklı
// User kaydının paylaşması mümkün değil zaten, ama açıkça userId'ye göre
// dedup daha doğru bir niyet ifadesi).
@Processor('status-change-notifications')
export class StatusChangeNotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(StatusChangeNotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {
    super();
  }

  async process(
    job: Job<StatusChangeJobData>,
  ): Promise<{ recipientCount: number }> {
    const { postId, previousStatus, newStatus } = job.data;

    const post = await this.prisma.post.findUnique({
      where: { id: postId },
      select: {
        id: true,
        title: true,
        votes: {
          select: { user: { select: { id: true, email: true, name: true } } },
        },
        comments: {
          select: { author: { select: { id: true, email: true, name: true } } },
        },
      },
    });

    // Post job kuyruğa girdikten sonra (ör. merge edilip) kaybolmuş olabilir
    // — 4.3'ün widget identify P2002 yarışındaki "asenkron bir işlemin
    // tetiklendiği an ile gerçekten çalıştığı an arasında dünya değişmiş
    // olabilir" ilkesiyle aynı temkin. Job'ı retry'a düşürecek bir hata
    // fırlatmıyoruz — post zaten yok, tekrar denemek sonucu değiştirmez.
    if (!post) {
      this.logger.warn(
        `status-change job'ı artık bulunamayan bir post için geldi (postId=${postId}), atlanıyor`,
      );
      return { recipientCount: 0 };
    }

    const recipients = new Map<string, { email: string; name: string }>();
    for (const { user } of post.votes) recipients.set(user.id, user);
    for (const { author } of post.comments) recipients.set(author.id, author);

    const subject = `"${post.title}" güncellendi: ${STATUS_LABELS[newStatus]}`;
    // 5.4 — aynı olay hem email'e (dışarıya, "iyi niyetli" — başarısız
    // olursa job zaten fail eder) hem in-app bildirim merkezine (içeride,
    // apps/web'in zil ikonu) gidiyor. Tek bir kısa mesaj metni ikisinde de
    // paylaşılmıyor (email daha uzun/resmi, in-app daha kısa) — farklı
    // okuma bağlamları (inbox vs. dropdown).
    const inAppMessage = `"${post.title}" artık "${STATUS_LABELS[newStatus]}" durumunda.`;

    for (const [userId, recipient] of recipients) {
      const body =
        `Merhaba ${recipient.name},\n\n` +
        `Oy verdiğin veya yorum yaptığın "${post.title}" başlıklı öneri artık ` +
        `"${STATUS_LABELS[newStatus]}" durumunda (önceki durum: ` +
        `"${STATUS_LABELS[previousStatus]}").`;
      await this.emailProvider.send({ to: recipient.email, subject, body });
      await this.prisma.notification.create({
        data: { userId, postId: post.id, message: inAppMessage },
      });
    }

    this.logger.log(
      `status-change bildirimi işlendi (postId=${postId}, ${previousStatus}→${newStatus}): ${recipients.size} alıcı`,
    );
    return { recipientCount: recipients.size };
  }
}
