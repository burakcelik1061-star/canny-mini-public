import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AllExceptionsFilter } from './observability/all-exceptions.filter';

// Faz 7.1 — main.ts'teki global yapılandırma buraya taşındı ki integration
// testleri (test/integration/integration-app.ts) UYGULAMANIN KENDİSİYLE aynı
// pipeline'ı çalıştırsın. Bir kopyasını test tarafında tutsaydık, ileride
// buraya eklenen bir global pipe/interceptor testlerde sessizce eksik kalır
// ve testler prod'da olmayan bir uygulamayı doğrulamaya başlardı.
//
// DİKKAT: `rawBody: true` burada DEĞİL, `NestFactory.create`/
// `createNestApplication` çağrısında verilmek zorunda (bir uygulama
// seçeneği, sonradan eklenebilen bir middleware değil) — hem main.ts hem
// integration-app.ts bunu ayrıca veriyor, bkz. billing webhook imzası.
export function configureApp(app: INestApplication): void {
  // trust proxy: VARSAYILAN KAPALI (güvenli varsayılan). Bir reverse-proxy/LB
  // arkasında değilken açık olsaydı, saldırgan `X-Forwarded-For` uydurup
  // rate-limit'i (Throttler `req.ip`'i kullanıyor) atlatabilirdi. Bir proxy
  // arkasına deploy edilirse TRUST_PROXY env ile açılır: sayı = güvenilen hop
  // sayısı (ör. "1"), aksi halde ham değer (ör. "loopback"). Bu proje şu an
  // local-only, o yüzden pratikte kapalı.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    (app as NestExpressApplication).set(
      'trust proxy',
      /^\d+$/.test(trustProxy) ? Number(trustProxy) : trustProxy,
    );
  }

  // Faz 7.4 — güvenlik başlıkları (X-Content-Type-Options, HSTS,
  // Referrer-Policy vb.). Global `contentSecurityPolicy` KAPALI: apps/api bir
  // JSON API; döndürdüğü tek HTML olan mock Stripe checkout/portal sayfaları
  // (6.1/6.3) artık SAYFAYA ÖZEL sıkı bir CSP header'ı taşıyor (bkz.
  // billing.controller.ts → @Header('Content-Security-Policy', ...): script
  // yok, sadece inline style). apps/web'in HTML'i ise Next.js tarafında ayrı
  // bir konu.
  app.use(helmet({ contentSecurityPolicy: false }));

  app.use(cookieParser());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // DTO'da tanımlı olmayan alanları sessizce atar
      forbidNonWhitelisted: true, // ...ve tanımlı olmayan alan gelirse hata döner
      transform: true,
    }),
  );

  // apps/web (Next.js, :3000) ve apps/widget (Vite, :5173 — Faz 4.1) farklı
  // origin'lerden çağıracak; refresh cookie'sinin gidip gelmesi için
  // credentials: true şart. WEB_ORIGIN virgülle ayrılmış birden fazla origin
  // kabul eder (prod'da tek bir origin — apps/web — yeterliydi, widget
  // eklenince listeye ihtiyaç doğdu).
  const allowedOrigins = (
    process.env.WEB_ORIGIN ?? 'http://localhost:3000,http://localhost:5173'
  )
    .split(',')
    .map((origin) => origin.trim());
  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
  });

  // Faz 7.4 — global hata filtresi. DI ile alınıyor (`new
  // AllExceptionsFilter()` değil) çünkü ERROR_TRACKER'ı enjekte ediyor;
  // ObservabilityModule @Global olduğu için her uygulamada çözülebiliyor.
  app.useGlobalFilters(app.get(AllExceptionsFilter));
}
