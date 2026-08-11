import { readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_URL = 'postgresql://canny:canny@localhost:5432/canny_mini_test';

// Integration testleri ASLA geliştirme veritabanına dokunmamalı — her test
// dosyası arasında TRUNCATE atıyoruz (bkz. resetDatabase), yanlış URL'e
// bağlanmak local verinin sessizce silinmesi demek olurdu. Bu yüzden test
// DB'si ayrı bir veritabanı ve adı hiçbir zaman geliştirme DB'siyle aynı
// olamaz (bkz. aşağıdaki assert).
//
// Çözüm sırası:
//   1. TEST_DATABASE_URL (CI bunu veriyor, bkz. .github/workflows/ci.yml)
//   2. apps/api/.env'deki DATABASE_URL'den türet (`..._test`) — local'de
//      docker-compose'daki kendi kimlik bilgilerini otomatik kullansın diye
//   3. docker-compose varsayılanlarıyla sabit bir değer
export function resolveTestDatabaseUrl(): string {
  const explicit = process.env.TEST_DATABASE_URL?.trim();
  if (explicit) {
    return assertNotDevDatabase(explicit);
  }

  const derived = deriveFromDevEnvFile();
  return assertNotDevDatabase(derived ?? DEFAULT_URL);
}

// apps/api/.env'i dotenv olmadan, sadece DATABASE_URL satırı için okuyoruz —
// pnpm'in katı node_modules'ünde dotenv apps/api'nin doğrudan bağımlılığı
// değil (yalnızca @nestjs/config üzerinden transitif), ayrıca burada
// gereken tek şey tek bir satır.
function deriveFromDevEnvFile(): string | undefined {
  try {
    const contents = readFileSync(join(__dirname, '../../.env'), 'utf-8');
    const match = contents.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (!match) {
      return undefined;
    }
    const url = new URL(match[1]);
    url.pathname = `${url.pathname}_test`;
    return url.toString();
  } catch {
    return undefined;
  }
}

function assertNotDevDatabase(url: string): string {
  // pathname = "/<veritabanı adı>"
  if (!new URL(url).pathname.endsWith('_test')) {
    throw new Error(
      `Integration test veritabanının adı "_test" ile bitmeli (alınan: ${url}). ` +
        'Bu kontrol, testlerin TRUNCATE ile geliştirme veritabanını silmesini önlüyor.',
    );
  }
  return url;
}
