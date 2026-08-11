import { appendFile, mkdir } from 'fs/promises';
import { LogEmailProvider } from './log-email.provider';

jest.mock('fs/promises', () => ({
  appendFile: jest.fn(),
  mkdir: jest.fn(),
}));

describe('LogEmailProvider', () => {
  let provider: LogEmailProvider;

  beforeEach(() => {
    jest.clearAllMocks();
    provider = new LogEmailProvider();
  });

  it('logs klasörünü oluşturup emails.log dosyasına bir JSON satırı ekler', async () => {
    (mkdir as jest.Mock).mockResolvedValue(undefined);
    (appendFile as jest.Mock).mockResolvedValue(undefined);

    await provider.send({
      to: 'user@example.com',
      subject: 'Post durumu değişti',
      body: 'Merhaba, oy verdiğin post artık "Planlandı" durumunda.',
    });

    expect(mkdir).toHaveBeenCalledWith(expect.stringContaining('logs'), {
      recursive: true,
    });
    expect(appendFile).toHaveBeenCalledTimes(1);
    const [path, content] = (appendFile as jest.Mock).mock.calls[0] as [
      string,
      string,
    ];
    expect(path).toContain('emails.log');

    const parsed: unknown = JSON.parse(content.trim());
    expect(parsed).toMatchObject({
      to: 'user@example.com',
      subject: 'Post durumu değişti',
      body: 'Merhaba, oy verdiğin post artık "Planlandı" durumunda.',
    });
    expect((parsed as { sentAt?: string }).sentAt).toBeDefined();
  });
});
