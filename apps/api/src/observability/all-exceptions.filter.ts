import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import type { Response } from 'express';
import { ERROR_TRACKER, type ErrorTracker } from './error-tracker.interface';
import type { RequestWithId } from './request-id.middleware';

interface AuthenticatedRequest extends RequestWithId {
  user?: { sub?: string };
}

// Faz 7.4 — tüm istisnaların tek geçtiği yer. İki sorumluluğu var:
//
//   1. BEKLENMEYEN hataları (5xx) ErrorTracker'a bildirmek. 4xx'ler
//      bildirilmiyor: onlar "kullanıcı yanlış bir şey yaptı" demek
//      (validation, 401, 404, plan limiti) — hepsini hata olarak raporlamak
//      gerçek sorunları gürültüde boğardı.
//   2. Beklenmeyen bir hatanın İÇERİĞİNİ istemciye sızdırmamak. Ham hata
//      mesajı (Prisma sorgusu, dosya yolu, stack) dışarı çıkmamalı;
//      kullanıcı sadece requestId'yi görüyor, ayrıntı log'da kalıyor.
//
// HttpException'ların gövdesi BİLİNÇLİ olarak korunuyor, yeniden
// yazılmıyor — apps/web `PlanLimitExceededException`'ın `error` alanındaki
// `PLAN_LIMIT_EXCEEDED` kodunu ve `message`'ı okuyor (bkz. lib/api.ts →
// parseErrorBody). Sadece `requestId` ekleniyor, mevcut alanlara
// dokunulmuyor.
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    @Inject(ERROR_TRACKER) private readonly errorTracker: ErrorTracker,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<AuthenticatedRequest>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const requestId = request.requestId ?? 'bilinmiyor';

    // Sayısal karşılaştırma: `status` HttpException.getStatus()'tan
    // geldiğinde düz bir number, HttpStatus ise bir enum — eslint'in
    // no-unsafe-enum-comparison kuralı ikisini doğrudan karşılaştırmaya
    // izin vermiyor.
    if (status >= Number(HttpStatus.INTERNAL_SERVER_ERROR)) {
      this.errorTracker.captureException(exception, {
        requestId,
        method: request.method,
        path: request.url,
        userId: request.user?.sub,
        statusCode: status,
      });
    }

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      // Nest bir HttpException'a STRING verilmişse gövdeyi kendisi
      // sarmalıyor; obje verilmişse (PlanLimitExceededException) olduğu
      // gibi kullanıyor. İki durumu da bozmadan requestId ekliyoruz.
      const payload =
        typeof body === 'string'
          ? { statusCode: status, message: body }
          : { ...(body as Record<string, unknown>) };

      response.status(status).json({ ...payload, requestId });
      return;
    }

    response.status(status).json({
      statusCode: status,
      message: 'Beklenmeyen bir hata oluştu',
      requestId,
    });
  }
}
