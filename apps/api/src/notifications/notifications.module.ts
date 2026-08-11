import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { StatusChangeNotificationProcessor } from './status-change-notification.processor';

// NotificationsController (5.4, /notifications) org-scoped bir kaynak
// DEĞİL — PostsModule bu modülü zaten import ettiği (5.2'nin ihtiyacı)
// için AppModule'e ayrıca eklenmesine gerek yok, Nest controller'ları
// modülün import grafiğindeki HERHANGİ bir yerden erişilebilir hale
// getiriyor.
@Module({
  imports: [
    BullModule.registerQueue({ name: 'status-change-notifications' }),
    EmailModule,
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService, StatusChangeNotificationProcessor],
  exports: [NotificationsService],
})
export class NotificationsModule {}
