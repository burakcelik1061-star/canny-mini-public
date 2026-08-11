import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAccessGuard } from '../../auth/guards/jwt-access.guard';
import { DiagnosticRouteGuard } from '../../common/guards/diagnostic-route.guard';
import { HelloWorldService } from './hello-world.service';

// Bu uç org-scoped bir kaynak DEĞİL (bkz. "Kurallar" → org izolasyonu) —
// sadece Faz 5.1'in "queue altyapısı gerçekten çalışıyor mu" doğrulaması
// için bir tetikleyici, kalıcı bir ürün özelliği değil. JwtAccessGuard'a ek
// olarak DiagnosticRouteGuard ile production'da tamamen kapalı (weekly-digest
// tetikleyicisiyle aynı gerekçe — diagnostic uçlar canlıda durmamalı).
@UseGuards(JwtAccessGuard, DiagnosticRouteGuard)
@Controller('internal/jobs/hello-world')
export class HelloWorldController {
  constructor(private readonly helloWorldService: HelloWorldService) {}

  @Post()
  async trigger(@Body('message') message?: string): Promise<{ jobId: string }> {
    return this.helloWorldService.enqueue(message);
  }
}
