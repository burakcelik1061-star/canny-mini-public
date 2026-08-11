import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { join } from 'path';
import {
  DEFAULT_THROTTLE_LIMIT,
  DEFAULT_THROTTLE_TTL_MS,
  throttlingDisabled,
} from './common/throttler.constants';
import { validateEnv } from './config/env.validation';
import { ObservabilityModule } from './observability/observability.module';
import { RequestIdMiddleware } from './observability/request-id.middleware';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { BoardsModule } from './boards/boards.module';
import { DigestModule } from './digest/digest.module';
import { HelloWorldModule } from './jobs/hello-world/hello-world.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { PostsModule } from './posts/posts.module';
import { PrismaModule } from './prisma/prisma.module';
import { QueueModule } from './queue/queue.module';
import { TagsModule } from './tags/tags.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // Monorepo'da tek .env kaynağı kök dizinde tutuluyor.
      envFilePath: join(__dirname, '../../../.env'),
      // Sır doğrulaması boot zamanında: zayıf/placeholder bir JWT ya da
      // webhook secret'ı production'da boot'u durdurur, dev/test'te uyarır
      // (bkz. config/env.validation.ts).
      validate: validateEnv,
    }),
    // Faz 7.4 — rate limiting. Global bir guard olarak bağlanıyor (aşağıda
    // APP_GUARD), yani YENİ eklenen her endpoint otomatik olarak kapsam
    // içinde: "her yeni uca ayrıca eklemeyi unutma" gibi kırılgan bir
    // kurala dayanmıyor (OrgMembershipGuard'ın merkezi olması kararıyla
    // aynı mantık). Auth uçları ayrıca @Throttle ile daraltılıyor.
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        throttlers: [
          {
            ttl: config.get<number>('THROTTLE_TTL_MS', DEFAULT_THROTTLE_TTL_MS),
            limit: config.get<number>('THROTTLE_LIMIT', DEFAULT_THROTTLE_LIMIT),
          },
        ],
        // İstek anında değerlendiriliyor (dekoratörlerin aksine) — bkz.
        // throttler.constants.ts.
        skipIf: () => throttlingDisabled(),
      }),
    }),
    ObservabilityModule,
    PrismaModule,
    QueueModule,
    AuthModule,
    OrganizationsModule,
    BoardsModule,
    TagsModule,
    PostsModule,
    HelloWorldModule,
    DigestModule,
    BillingModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  // Request id middleware'i TÜM route'lara bağlanıyor — hata filtresi
  // (AllExceptionsFilter) bu id'yi hem log'a hem yanıta koyuyor.
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware).forRoutes('*');
  }
}
