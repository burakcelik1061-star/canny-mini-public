import { Logger } from '@nestjs/common';

// Faz "sertleştirme" — sır (secret) doğrulaması BOOT ZAMANINDA.
//
// Sorun: `.env.example` bir zamanlar ÇALIŞAN placeholder değerler
// (`changeme_*`, `whsec_mock_local_dev_secret`) taşıyordu ve README "olduğu
// gibi çalışır" diyordu. Bilinen bir JWT secret'ı = tam kimlik taklidi
// (`{sub, email}`'i o secret'la imzala, OrgMembershipGuard sorunsuz geçer);
// bilinen bir webhook secret'ı = herhangi bir org'u PRO yapan sahte webhook.
// Sırf "tanımlı mı" kontrolü (getOrThrow) bu tuzağı yakalamıyordu.
//
// Çözüm: ConfigModule.forRoot({ validate }) ile app boot'unda çalışan bu
// fonksiyon. Zayıf/placeholder/eksik bir sır bulursa:
//   - production'da HATA fırlatır → uygulama HİÇ boot etmez (asıl koruma),
//   - dev/test/e2e'de yüksek sesle UYARIR ama boot'a izin verir → CI ve
//     yerel testler kırılmaz (onlar zaten dışarıya açık değil).

const logger = new Logger('EnvValidation');

// Repo tarihinde/dokümanlarda gerçekten kullanılmış, "sır" sayılmaması gereken
// değerler. Bunlar bir prod ortamında ASLA bulunmamalı.
const KNOWN_PLACEHOLDERS = new Set<string>([
  'changeme_access_secret',
  'changeme_refresh_secret',
  'whsec_mock_local_dev_secret',
  'ci_access_secret',
  'ci_refresh_secret',
  'whsec_ci_test_secret',
]);

// Bir "whsec_" öneki dekoratif — gerçek entropi ölçülürken sayılmaz.
const STRIPE_PREFIX = 'whsec_';
const MIN_SECRET_ENTROPY_CHARS = 24;

function secretProblems(name: string, rawValue: unknown): string[] {
  const problems: string[] = [];
  if (typeof rawValue !== 'string' || rawValue.length === 0) {
    problems.push(`${name} tanımlı değil (boş).`);
    return problems;
  }
  const value = rawValue.trim();

  if (KNOWN_PLACEHOLDERS.has(value)) {
    problems.push(`${name} bilinen bir placeholder/örnek değer taşıyor.`);
  }
  if (/change[_-]?me/i.test(value) || value.includes('__GENERATE_ME__')) {
    problems.push(`${name} hâlâ bir "değiştir beni" placeholder'ı.`);
  }

  const entropyPart = value.startsWith(STRIPE_PREFIX)
    ? value.slice(STRIPE_PREFIX.length)
    : value;
  if (entropyPart.length < MIN_SECRET_ENTROPY_CHARS) {
    problems.push(
      `${name} çok kısa (${entropyPart.length} karakter, en az ${MIN_SECRET_ENTROPY_CHARS} beklenir). ` +
        `Öneri: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`,
    );
  }
  return problems;
}

export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const problems: string[] = [
    ...secretProblems('JWT_ACCESS_SECRET', config.JWT_ACCESS_SECRET),
    ...secretProblems('JWT_REFRESH_SECRET', config.JWT_REFRESH_SECRET),
    ...secretProblems('STRIPE_WEBHOOK_SECRET', config.STRIPE_WEBHOOK_SECRET),
  ];

  // Access ve refresh AYNI secret'ı paylaşamaz: paylaşırlarsa iki token
  // sınıfının kriptografik ayrımı yok olur (bir refresh token, access
  // doğrulamasından da geçebilir hâle gelir).
  if (
    typeof config.JWT_ACCESS_SECRET === 'string' &&
    config.JWT_ACCESS_SECRET === config.JWT_REFRESH_SECRET
  ) {
    problems.push(
      'JWT_ACCESS_SECRET ile JWT_REFRESH_SECRET aynı — ayrı değerler olmalı.',
    );
  }

  if (problems.length > 0) {
    const isProd = config.NODE_ENV === 'production';
    const header =
      'Ortam sırları (secret) doğrulaması başarısız:\n  - ' +
      problems.join('\n  - ');
    if (isProd) {
      // Production'da sessizce çalışmaya devam etmek, tam olarak kaçınmak
      // istediğimiz sessiz-güvensiz durumdur.
      throw new Error(
        `${header}\nProduction'da güvensiz sırlarla boot edilmez. .env'i düzeltip yeniden başlatın.`,
      );
    }
    logger.warn(
      `${header}\n(dev/test — boot'a izin veriliyor; production'da bu uygulamayı BOOT ETTİRMEZ.)`,
    );
  }

  return config;
}
