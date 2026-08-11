import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

export interface HelloWorldJobData {
  message: string;
}

// Gerçek bir mail/digest provider'ı yok,
// bu yüzden 5.1'in "çalıştığını doğrula" hedefi burada: worker gerçekten
// ayrı bir event loop turu/bağlantısı üzerinden (aynı process içinde ama
// BullMQ'nun kendi polling/blocking-connection mekanizmasıyla) job'ı işliyor
// mu? console.log değil NestJS Logger kullanılıyor — 5.2/5.3'ün gerçek
// job'ları da aynı deseni izleyecek (log dosyasına yazan EmailProvider'ın
// da aynı Logger altyapısını kullanması planlanıyor).
@Processor('hello-world')
export class HelloWorldProcessor extends WorkerHost {
  private readonly logger = new Logger(HelloWorldProcessor.name);

  // eslint-disable-next-line @typescript-eslint/require-await -- WorkerHost.process imzası async bekliyor; 5.2/5.3'ün gerçek job'ları (email gönderimi vb.) burada gerçekten await edecek.
  async process(job: Job<HelloWorldJobData>): Promise<{ echoedAt: string }> {
    this.logger.log(
      `hello-world job işlendi (id=${job.id}, attempt=${job.attemptsMade + 1}): "${job.data.message}"`,
    );
    return { echoedAt: new Date().toISOString() };
  }
}
