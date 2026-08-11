import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app-setup';

async function bootstrap() {
  // rawBody: true — Faz 6.1'in Stripe webhook doğrulaması (POST
  // /billing/webhook) gövdeyi JSON.parse edilmiş bir obje değil, ağdan
  // geldiği TAM byte dizisiyle imzalıyor (gerçek Stripe SDK'sının da
  // ısrarla istediği şey — bkz. billing.controller.ts). Diğer tüm route'lar
  // için davranış değişmiyor, sadece `req.rawBody` ek olarak dolduruluyor.
  const app = await NestFactory.create(AppModule, { rawBody: true });

  // cookieParser + ValidationPipe + CORS — Faz 7.1'de app-setup.ts'e taşındı
  // ki integration testleri aynı yapılandırmayı paylaşsın (bkz. o dosyanın
  // başındaki yorum).
  configureApp(app);

  await app.listen(process.env.PORT ?? 3333);
}
void bootstrap();
