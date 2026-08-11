import { execFileSync } from 'child_process';
import { join } from 'path';
import { resolveTestDatabaseUrl } from './test-database-url';

// Jest globalSetup — integration testleri başlamadan ÖNCE bir kez çalışır.
// İki iş yapıyor:
//   1. DATABASE_URL'i test veritabanına çevirir. @nestjs/config, .env
//      dosyasındaki değerleri process.env'de ZATEN VAR OLAN bir anahtarın
//      üzerine yazmaz — bu yüzden burada set etmek, uygulamanın kök .env'deki
//      geliştirme DB'sine bağlanmasını güvenle engelliyor.
//   2. Şemayı test veritabanına uygular (`prisma migrate deploy`). Böylece
//      testler migration'ların GERÇEKTEN uygulanabilir olduğunu da kanıtlıyor
//      — migration dosyası bozuksa CI burada kırmızıya döner.
export default function globalSetup(): void {
  const databaseUrl = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = databaseUrl;

  const apiRoot = join(__dirname, '../..');
  execFileSync(
    'node',
    [
      join(apiRoot, 'node_modules/prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      join(apiRoot, 'prisma/schema.prisma'),
    ],
    {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      stdio: 'inherit',
    },
  );
}
