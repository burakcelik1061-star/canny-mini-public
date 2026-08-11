import { Global, Module } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { ERROR_TRACKER } from './error-tracker.interface';
import { LogErrorTracker } from './log-error.tracker';

// EmailModule'ün aksine @Global(): AllExceptionsFilter uygulamanın TAMAMI
// için tek bir global filtre olarak bağlanıyor (main.ts) ve ERROR_TRACKER'ı
// enjekte ediyor — her modülün ayrıca import etmesini beklemek anlamsız
// olurdu (PrismaModule ile aynı gerekçe).
//
// Gerçek bir Sentry/Bugsnag eklenirse değişecek TEK yer aşağıdaki
// `useClass` satırı (bkz. error-tracker.interface.ts).
@Global()
@Module({
  providers: [
    { provide: ERROR_TRACKER, useClass: LogErrorTracker },
    AllExceptionsFilter,
  ],
  exports: [ERROR_TRACKER, AllExceptionsFilter],
})
export class ObservabilityModule {}
