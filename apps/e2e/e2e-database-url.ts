import { readFileSync } from 'fs';
import { join } from 'path';

const DEFAULT_URL = 'postgresql://canny:canny@localhost:5432/canny_mini_e2e';

// Faz 7.1'deki `test-database-url.ts` ile AYNI gerekçe ve aynı desen, farklı
// bir veritabanı için: E2E koşusu `prisma migrate reset` ile şemayı komple
// düşürüp yeniden kuruyor — yanlış bir URL geliştirme verisinin tamamını
// silmek demek olurdu. Bu yüzden ad `_e2e` ile bitmek ZORUNDA.
//
// (7.1'in helper'ıyla kod paylaşmıyoruz: apps/e2e bağımsız bir paket, tıpkı
// apps/widget'ın apps/web'e bağımlı olmaması gibi — apps/api'nin test
// klasöründen import etmek iki paketi birbirine bağlardı.)
//
// Çözüm sırası:
//   1. E2E_DATABASE_URL (CI ileride bunu verecek — 7.3)
//   2. apps/api/.env'deki DATABASE_URL'den türet (`..._e2e`)
//   3. docker-compose varsayılanlarıyla sabit bir değer
export function resolveE2eDatabaseUrl(): string {
  const explicit = process.env.E2E_DATABASE_URL?.trim();
  if (explicit) {
    return assertE2eDatabase(explicit);
  }
  return assertE2eDatabase(deriveFromDevEnvFile() ?? DEFAULT_URL);
}

function deriveFromDevEnvFile(): string | undefined {
  try {
    const contents = readFileSync(
      join(__dirname, '../api/.env'),
      'utf-8',
    );
    const match = contents.match(/^\s*DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
    if (!match) {
      return undefined;
    }
    const url = new URL(match[1]);
    url.pathname = `${url.pathname}_e2e`;
    return url.toString();
  } catch {
    return undefined;
  }
}

function assertE2eDatabase(url: string): string {
  // pathname = "/<veritabanı adı>"
  if (!new URL(url).pathname.endsWith('_e2e')) {
    throw new Error(
      `E2E veritabanının adı "_e2e" ile bitmeli (alınan: ${url}). ` +
        'Bu kontrol, E2E koşusunun geliştirme veritabanını düşürmesini önlüyor.',
    );
  }
  return url;
}
