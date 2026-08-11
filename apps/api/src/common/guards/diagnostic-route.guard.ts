import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';

// Diagnostic job tetikleyicilerini (POST /internal/jobs/*) production'da
// KAPATIR. Bu uçlar kalıcı ürün özellikleri değil, "queue/digest gerçekten
// çalışıyor mu" doğrulaması için manuel tetikleyiciler (bkz. ilgili
// controller yorumları). Sorun: sadece JwtAccessGuard'la korunuyorlardı —
// widget identify ile üretilmiş, hiçbir org'a üye OLMAYAN bir end-user token'ı
// bile weekly-digest processor'ını çalıştırıp TÜM org'lara e-posta
// tetikleyebiliyordu. Gerçek bir e-posta sağlayıcısı bağlanınca bu doğrudan
// bir spam/veri-tetikleme ucuna dönüşürdü.
//
// Kural: production'da varsayılan KAPALI (route yokmuş gibi 404). Dev/test/e2e
// için açık; istenirse ENABLE_DIAGNOSTIC_JOB_ROUTES=true ile prod'da da
// bilinçli olarak açılabilir. 404 (403 değil): kapalıyken ucun varlığı bile
// sızmasın.
@Injectable()
export class DiagnosticRouteGuard implements CanActivate {
  canActivate(): boolean {
    if (diagnosticRoutesEnabled()) {
      return true;
    }
    throw new NotFoundException();
  }
}

export function diagnosticRoutesEnabled(): boolean {
  if (process.env.ENABLE_DIAGNOSTIC_JOB_ROUTES === 'true') {
    return true;
  }
  return process.env.NODE_ENV !== 'production';
}
