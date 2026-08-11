// Faz 7.4 — rate limiting ayarları.
//
// Genel limit env'den ayarlanabilir (yük profiline göre değişebilecek bir
// şey), auth limiti ise KOD'da sabit: bir dekoratör (`@Throttle`) import
// zamanında değerlendiği için ConfigService'i okuyamaz. Auth limiti zaten
// bir ürün kararı değil güvenlik kararı — ortama göre gevşetilecek bir şey
// olmamalı.

export const DEFAULT_THROTTLE_TTL_MS = 60_000;
export const DEFAULT_THROTTLE_LIMIT = 120;

// Kaba kuvvet denemelerini yavaşlatmak için belirgin şekilde daha dar bir
// pencere: dakikada 10 giriş/kayıt denemesi gerçek bir kullanıcı için
// fazlasıyla yeterli, otomatik bir şifre denemesi için değil.
export const AUTH_THROTTLE = {
  limit: 10,
  ttl: DEFAULT_THROTTLE_TTL_MS,
};

// Testlerin çoğu (özellikle 7.1'in integration suite'i) aynı IP'den çok
// sayıda kayıt/giriş yapıyor ve limite takılırdı. Bu bayrak SADECE test
// harness'ı tarafından set ediliyor; `skipIf` istek anında okunduğu için
// (dekoratörlerin aksine) burada env okumak güvenli.
//
// Bayrağın kendisi de test ediliyor: throttling.integration-spec.ts
// bayrak OLMADAN bir uygulama kurup gerçekten 429 aldığını doğruluyor,
// yani "testler geçsin diye rate limiting'i kapattık" durumu oluşmuyor.
export const THROTTLE_DISABLED_ENV = 'THROTTLE_DISABLED';

export function throttlingDisabled(): boolean {
  return process.env[THROTTLE_DISABLED_ENV] === 'true';
}
