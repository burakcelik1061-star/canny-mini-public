// Faz 5.2 — gerçek bir mail sağlayıcısı (Resend/SendGrid) hesabı YOK
// ve Faz 7.5'e kadar açılmayacak. Bu
// arayüz onun yerine geçen soyutlama: bugün tek implementasyonu
// `LogEmailProvider` (konsola/log dosyasına yazar), ileride gerçek bir
// sağlayıcı eklemek `EmailModule`'deki tek bir `useClass` satırını
// değiştirmek olacak — çağıran kodun (`NotificationsService` vb.) hiçbiri
// değişmeyecek.
export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
}

export interface EmailProvider {
  send(message: EmailMessage): Promise<void>;
}

// DI token — interface'ler TypeScript'te runtime'da yok olduğu için
// (`@Inject(EmailProvider)` çalışmaz), string token JwtModule/PrismaService
// gibi somut sınıflarla enjekte edilenlerden farklı bir desen (bkz.
// email.module.ts).
export const EMAIL_PROVIDER = 'EMAIL_PROVIDER';
