import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

// Her Pazartesi 09:00 (cron: dakika saat gün ay hafta-günü). BullMQ v6'da
// tekrarlanan job'lar `queue.add(..., {repeat})` ile DEĞİL, ayrı bir "Job
// Scheduler" API'siyle kuruluyor (`upsertJobScheduler`) — isminden de belli
// olduğu gibi UPSERT: aynı `schedulerId` ile tekrar çağırmak (ör. her
// `nest start`'ta olduğu gibi) yeni bir kopya oluşturmaz, var olanı
// günceller. `onModuleInit`'i app başlangıcında güvenle her seferinde
// çağırabiliriz (idempotent).
const WEEKLY_DIGEST_SCHEDULER_ID = 'weekly-digest-scheduler';
const WEEKLY_SCHEDULE_CRON = '0 9 * * 1';

@Injectable()
export class WeeklyDigestService implements OnModuleInit {
  private readonly logger = new Logger(WeeklyDigestService.name);

  constructor(@InjectQueue('weekly-digest') private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(WEEKLY_DIGEST_SCHEDULER_ID, {
      pattern: WEEKLY_SCHEDULE_CRON,
    });
    this.logger.log(
      `Haftalık digest job'ı zamanlandı (cron: "${WEEKLY_SCHEDULE_CRON}", her Pazartesi 09:00)`,
    );
  }

  // Diagnostic tetikleyici (5.1'in hello-world'ünde kurulan desen) — bir
  // haftayı beklemeden manuel doğrulama için, zamanlanmış job'dan bağımsız
  // tek seferlik bir çalıştırma.
  async triggerNow(): Promise<{ jobId: string }> {
    const job = await this.queue.add('weekly-digest', {});
    if (!job.id) {
      throw new Error('BullMQ job id döndürmedi (beklenmeyen durum)');
    }
    return { jobId: job.id };
  }
}
