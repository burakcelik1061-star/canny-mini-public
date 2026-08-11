import { Module } from '@nestjs/common';
import { EMAIL_PROVIDER } from './email-provider.interface';
import { LogEmailProvider } from './log-email.provider';

// Global DEĞİL — QueueModule'deki aynı gerekçe (5.1): ihtiyaç duyan modül
// (NotificationsModule) açıkça import eder. Gerçek bir sağlayıcı eklenince
// (Faz 7.5 sonrası karar) burada sadece `useClass: LogEmailProvider` →
// `useClass: ResendEmailProvider` değişir, NotificationsService hiç
// dokunulmaz.
@Module({
  providers: [{ provide: EMAIL_PROVIDER, useClass: LogEmailProvider }],
  exports: [EMAIL_PROVIDER],
})
export class EmailModule {}
