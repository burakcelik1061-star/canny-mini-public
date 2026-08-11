import { ForbiddenException } from '@nestjs/common';

// Frontend'in bunu generic bir 403'ten AYIRT EDİP "Pro'ya yükselt" CTA'sı
// gösterebilmesi için response body'sinin `error` alanına sabit bir kod
// koyuyoruz (bkz. apps/web/src/lib/api.ts → parseErrorBody). Nest'in
// HttpException'ına bir STRING verilirse `error` alanı otomatik "Forbidden"
// olur — bu yüzden burada bilinçli olarak bir OBJE veriyoruz.
export const PLAN_LIMIT_EXCEEDED_CODE = 'PLAN_LIMIT_EXCEEDED';

export class PlanLimitExceededException extends ForbiddenException {
  constructor(message: string) {
    super({ message, error: PLAN_LIMIT_EXCEEDED_CODE });
  }
}
