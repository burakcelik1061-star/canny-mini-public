import { defineConfig, devices } from '@playwright/test';
import { join } from 'path';
import { resolveE2eDatabaseUrl } from './e2e-database-url';

const repoRoot = join(__dirname, '../..');

// E2E, geliştirme sunucularından AYRI portlarda çalışır (api :3334,
// web :3001). Bu bilinçli bir güvenlik önlemi: Playwright'ın
// `reuseExistingServer` seçeneği aynı portlarda zaten çalışan bir dev
// sunucusunu yakalayabilirdi ve o sunucu GELİŞTİRME veritabanına bağlı
// olurdu — E2E'nin `migrate reset`'i sessizce geliştirme verisini silerdi.
// Ayrı portlarla bu yapısal olarak imkânsız, üstelik dev sunucuları açıkken
// de E2E koşturulabiliyor.
const API_PORT = 3334;
const WEB_PORT = 3001;
const API_URL = `http://localhost:${API_PORT}`;
const WEB_URL = `http://localhost:${WEB_PORT}`;

const databaseUrl = resolveE2eDatabaseUrl();

export default defineConfig({
  testDir: './tests',
  // NOT: Şema kurulumu bilinçli olarak `globalSetup`'ta DEĞİL, aşağıdaki
  // api webServer komutunun içinde — Playwright webServer'ları
  // globalSetup'tan ÖNCE başlatıyor, yani orada yapılsaydı api henüz
  // olmayan bir veritabanına bağlanmaya çalışıp boot edemezdi (ilk
  // denemede tam olarak bu oldu: "Database canny_mini_e2e does not exist").
  // Komutun içinde olması ayrıca YIKICI `migrate reset`'in koşu başına tam
  // bir kez çalışmasını garanti ediyor: config dosyası her worker
  // sürecinde yeniden yükleniyor, oraya bir yan etki koymak testlerin
  // ortasında veritabanını silebilirdi.

  // Tek bir veritabanını paylaşan tek bir akış testi — paralellik yok.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  timeout: 60_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: WEB_URL,
    // Bir hata olduğunda "neden" sorusunu log okumadan cevaplayabilmek için:
    // ilk denemede iz tutulmaz (hızlı), başarısız olup tekrar denenirse tutulur.
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],

  webServer: [
    {
      // Önce şemayı uygula (migrate deploy veritabanını yoksa oluşturur,
      // varsa sadece eksik migration'ları ekler), sonra sunucuyu başlat.
      //
      // Bilinçli olarak `migrate reset` DEĞİL: o komut veritabanını
      // düşürüp yeniden kurar, yani veri yok eder. Buna hiç ihtiyaç yok —
      // testler her koşuda benzersiz org/board adları üretiyor (bkz.
      // tests/main-flow.spec.ts → RUN_ID), dolayısıyla eski koşuların
      // verisi yeni koşuyu etkilemiyor. Yıkıcı olmayan bir kurulum, hem
      // daha güvenli hem de yanlış bir DATABASE_URL durumunda telafi
      // edilemez bir kayıp riski taşımıyor (yine de resolveE2eDatabaseUrl
      // adın "_e2e" ile bitmesini şart koşuyor).
      //
      // Local'de dev sunucusu (watch) yeterli ve hızlı; 7.3'te CI'a
      // bağlanırken build + start:prod'a geçmek daha doğru olabilir.
      command:
        'pnpm --filter api exec prisma migrate deploy && pnpm --filter api dev',
      cwd: repoRoot,
      url: `${API_URL}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        // @nestjs/config, .env dosyasındaki bir değeri process.env'de ZATEN
        // VAR OLAN bir anahtarın üzerine yazmaz — bu üçü kök .env'i güvenle
        // eziyor. JWT secret'ları, REDIS_URL ve STRIPE_WEBHOOK_SECRET ise
        // kasten verilmiyor: local'de kök .env'den geliyorlar (7.3'te CI
        // bunları workflow env'inden verecek).
        DATABASE_URL: databaseUrl,
        PORT: String(API_PORT),
        // CORS: web'in E2E kopyası :3001'den çağıracak.
        WEB_ORIGIN: WEB_URL,
      },
    },
    {
      command: 'pnpm --filter web dev',
      cwd: repoRoot,
      url: WEB_URL,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        PORT: String(WEB_PORT),
        // lib/api.ts → API_BASE_URL bunu okuyor (varsayılanı :3333, yani
        // GELİŞTİRME api'si — bu satır olmadan E2E dev verisine bakardı).
        NEXT_PUBLIC_API_URL: API_URL,
      },
    },
  ],
});
