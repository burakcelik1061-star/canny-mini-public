import { Injectable, Logger } from '@nestjs/common';
import type { ErrorContext, ErrorTracker } from './error-tracker.interface';

// Bir Promise `throw 'string'` ya da `throw {code: 1}` ile de reddedilebilir
// — düz `String(error)` bir obje için '[object Object]' üretip teşhis
// değerini tamamen kaybettirirdi.
function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error === null || error === undefined) {
    return 'bilinmeyen';
  }
  try {
    // Döngüsel bir referans varsa JSON.stringify fırlatır — o durumda
    // hiç olmazsa tipini bildirelim.
    return JSON.stringify(error);
  } catch {
    return 'serialize edilemeyen bir değer';
  }
}

// `LogEmailProvider` (5.2) ile aynı yaklaşım: gerçek bir dış servis yerine
// NestJS `Logger`'a yazıyor. Gerçek bir Sentry entegrasyonunun göndereceği
// alanların AYNISINI (requestId, kullanıcı, istek, stack) topluyor —
// böylece sağlayıcı eklendiğinde toplanan bağlamın yeniden tasarlanması
// gerekmiyor, sadece "nereye gönderildiği" değişiyor.
@Injectable()
export class LogErrorTracker implements ErrorTracker {
  private readonly logger = new Logger('ErrorTracker');

  captureException(error: unknown, context: ErrorContext): void {
    const { requestId, method, path, statusCode, userId } = context;
    const message = describeError(error);

    // Tek satırda JSON: log dosyaları grep/jq ile taranabilsin diye
    // (emails.log'daki JSON satırı deseniyle aynı gerekçe).
    this.logger.error(
      JSON.stringify({
        requestId,
        method,
        path,
        statusCode,
        userId: userId ?? null,
        message,
      }),
      error instanceof Error ? error.stack : undefined,
    );
  }
}
