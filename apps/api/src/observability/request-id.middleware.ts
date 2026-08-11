import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

// `declare module 'express-serve-static-core'` ile global augmentation
// denendi ama pnpm'in katı node_modules'ünde o paket apps/api'den doğrudan
// çözülemiyor (transitif bir bağımlılık) — bunun yerine açık bir tip
// kullanıyoruz ve okuyan taraf onu import ediyor.
export interface RequestWithId extends Request {
  requestId?: string;
}

// Faz 7.4 — her isteğe bir kimlik. İki işe yarıyor:
//   1. Bir hata log'u ile kullanıcının gördüğü hata yanıtı aynı id'yi
//      taşıyor ("şu id ile hata aldım" → log'da tek grep).
//   2. Aynı isteğin farklı katmanlardaki satırları birbirine bağlanabiliyor.
//
// Gelen bir `X-Request-Id` varsa KORUNUYOR: gerçek bir kurulumda istek bir
// proxy/gateway üzerinden gelir ve id'yi o üretmiş olabilir; üzerine yazmak
// zinciri koparırdı.
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: RequestWithId, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    const requestId =
      (typeof incoming === 'string' && incoming.trim()) || randomUUID();

    req.requestId = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);
    next();
  }
}
