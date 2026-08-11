import { Injectable, Logger } from '@nestjs/common';
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { EmailMessage, EmailProvider } from './email-provider.interface';

// Gerçek hesap açılana kadarki tek adapter.
// Hem NestJS Logger'a (konsol, dev sırasında anında görünür — 5.1'in
// HelloWorldProcessor'ıyla aynı Logger deseni) hem de `apps/api/logs/
// emails.log`'a (JSON satırları, kalıcı — kanban'da status değiştirip
// "gerçekten email gönderilmiş mi" diye dosyaya bakılabilsin) yazıyor.
// Log dosyası .gitignore'da (bkz. kök .gitignore) — gerçek kullanıcı
// email'leri içerebilir.
@Injectable()
export class LogEmailProvider implements EmailProvider {
  private readonly logger = new Logger(LogEmailProvider.name);
  private readonly logFilePath = join(process.cwd(), 'logs', 'emails.log');

  async send(message: EmailMessage): Promise<void> {
    this.logger.log(`[MOCK EMAIL] → ${message.to}: "${message.subject}"`);

    const line = JSON.stringify({
      sentAt: new Date().toISOString(),
      ...message,
    });
    await mkdir(join(process.cwd(), 'logs'), { recursive: true });
    await appendFile(this.logFilePath, line + '\n', 'utf-8');
  }
}
