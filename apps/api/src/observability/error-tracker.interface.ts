// Faz 7.4 — "hata izleme" pratiği kod seviyesinde. Gerçek bir Sentry/
// Bugsnag hesabı YOK ve açılmayacak. Bu arayüz, `EmailProvider` (5.2) ve
// `StripeClient` (6.1) ile BİREBİR aynı desen: bugün tek implementasyonu
// yapılandırılmış bir log satırı yazan `LogErrorTracker`, ileride gerçek
// bir sağlayıcı eklemek `ObservabilityModule`'deki tek bir `useClass`
// satırını değiştirmek olacak — çağıran kod (AllExceptionsFilter) hiç
// dokunulmayacak.

export interface ErrorContext {
  /** Aynı isteğin tüm log satırlarını birbirine bağlayan id. */
  requestId: string;
  method: string;
  path: string;
  /** Giriş yapılmışsa — hangi kullanıcının etkilendiğini bilmek teşhisi hızlandırır. */
  userId?: string;
  statusCode: number;
}

export interface ErrorTracker {
  captureException(error: unknown, context: ErrorContext): void;
}

// DI token — interface'ler runtime'da yok olduğu için string token
// (EMAIL_PROVIDER/STRIPE_CLIENT ile aynı gerekçe).
export const ERROR_TRACKER = 'ERROR_TRACKER';
