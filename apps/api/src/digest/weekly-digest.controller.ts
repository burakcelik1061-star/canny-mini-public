import { Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { DiagnosticRouteGuard } from '../common/guards/diagnostic-route.guard';
import { WeeklyDigestService } from './weekly-digest.service';

// 5.1/5.2'deki aynı "diagnostic tetikleyici" deseni — kalıcı bir ürün ucu
// değil, gerçek zamanlanmış job (WeeklyDigestService.onModuleInit) bir
// haftayı beklemeden manuel doğrulanabilsin diye var. Processor TÜM org'ları
// tarayıp e-posta tetiklediği için production'da DiagnosticRouteGuard ile
// kapalı (bkz. o guard'ın yorumu) — sadece JwtAccessGuard yeterli değildi.
@UseGuards(JwtAccessGuard, DiagnosticRouteGuard)
@Controller('internal/jobs/weekly-digest')
export class WeeklyDigestController {
  constructor(private readonly weeklyDigestService: WeeklyDigestService) {}

  @Post()
  async trigger(): Promise<{ jobId: string }> {
    return this.weeklyDigestService.triggerNow();
  }
}
