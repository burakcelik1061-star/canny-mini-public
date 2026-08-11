import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';

// Faz 5.1 — Redis + BullMQ altyapısının tek kurulum noktası. Diğer job
// modülleri (5.2 status bildirimi, 5.3 haftalık digest) kendi kuyruklarını
// `BullModule.registerQueue({ name: '...' })` ile burada değil KENDİ
// modüllerinde açar (PrismaModule'ün aksine burası @Global DEĞİL) — sadece
// bağlantı (`forRootAsync`) merkezi, kuyruk tanımları dağınık kalır ki her
// job kendi modülünün içinde bağımsız test edilebilsin.
@Module({
  imports: [
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        // REDIS_URL zaten .env'de (bkz. docker-compose.yml → redis servisi,
        // Faz 0.3'ten beri kurulu ama Faz 5'e kadar hiç tüketilmemişti).
        // BullMQ/ioredis `connection` için host/port objesi bekliyor, tek
        // bir URL string'i değil.
        const redisUrl = new URL(config.getOrThrow<string>('REDIS_URL'));
        return {
          connection: {
            host: redisUrl.hostname,
            port: Number(redisUrl.port) || 6379,
          },
        };
      },
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
