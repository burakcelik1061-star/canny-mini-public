import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import { PostStatus } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { StatusChangeJobData } from './status-change-notification.processor';

const NOTIFICATION_LIST_LIMIT = 50;

// Frontend'in bildirim listesinde tıklanınca post'a link üretebilmesi için
// (`/${orgSlug}/${boardSlug}/${postId}`) gereken minimum ilişkisel veri.
export interface NotificationWithPost {
  id: string;
  message: string;
  read: boolean;
  createdAt: Date;
  postId: string | null;
  post: {
    id: string;
    title: string;
    board: { slug: string; organization: { slug: string } };
  } | null;
}

@Injectable()
export class NotificationsService {
  constructor(
    @InjectQueue('status-change-notifications')
    private readonly queue: Queue<StatusChangeJobData>,
    private readonly prisma: PrismaService,
  ) {}

  async enqueueStatusChangeNotification(
    postId: string,
    previousStatus: PostStatus,
    newStatus: PostStatus,
  ): Promise<void> {
    await this.queue.add('status-change', {
      postId,
      previousStatus,
      newStatus,
    });
  }

  // 5.4 — in-app bildirim merkezi. En yeni önce, sınırlı sayıda (sonsuz bir
  // liste/pagination bu adımın kapsamı dışı — "basit" bir bildirim listesi
  // isteniyordu).
  async listForUser(userId: string): Promise<NotificationWithPost[]> {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: NOTIFICATION_LIST_LIMIT,
      select: {
        id: true,
        message: true,
        read: true,
        createdAt: true,
        postId: true,
        post: {
          select: {
            id: true,
            title: true,
            board: {
              select: { slug: true, organization: { select: { slug: true } } },
            },
          },
        },
      },
    });
  }

  // `updateMany` + `count` kontrolü: hem "bulunamadı" hem "bu kullanıcıya
  // ait değil" aynı NotFoundException'a düşüyor (org-scoped guard'lardaki
  // "izolasyon ihlali = yok muamelesi" ilkesiyle aynı desen) — bir
  // kullanıcının başka bir kullanıcının bildirimini id tahmin ederek
  // "okundu" işaretleyip işaretlemediğini denemesi bile bilgi sızdırmaz.
  async markAsRead(userId: string, notificationId: string): Promise<void> {
    const result = await this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
    if (result.count === 0) {
      throw new NotFoundException('Bildirim bulunamadı');
    }
  }

  async markAllAsRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }
}
