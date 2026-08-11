import { Logger } from '@nestjs/common';
import { LogErrorTracker } from './log-error.tracker';

describe('LogErrorTracker', () => {
  let tracker: LogErrorTracker;
  let errorSpy: jest.SpyInstance;

  const context = {
    requestId: 'req-1',
    method: 'POST',
    path: '/organizations/org-1/boards',
    userId: 'user-1',
    statusCode: 500,
  };

  beforeEach(() => {
    errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    tracker = new LogErrorTracker();
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('bağlamı tek satır JSON olarak yazar (grep/jq ile taranabilsin)', () => {
    tracker.captureException(new Error('patladı'), context);

    const [payload] = errorSpy.mock.calls[0] as [string, string | undefined];
    expect(JSON.parse(payload)).toEqual({
      requestId: 'req-1',
      method: 'POST',
      path: '/organizations/org-1/boards',
      statusCode: 500,
      userId: 'user-1',
      message: 'patladı',
    });
  });

  it('stack’i ikinci argüman olarak geçirir', () => {
    const error = new Error('patladı');

    tracker.captureException(error, context);

    expect((errorSpy.mock.calls[0] as [string, string | undefined])[1]).toBe(
      error.stack,
    );
  });

  it('userId yoksa null yazar (alan kaybolmasın, aranabilir kalsın)', () => {
    tracker.captureException(new Error('x'), {
      ...context,
      userId: undefined,
    });

    const [payload] = errorSpy.mock.calls[0] as [string, string | undefined];
    expect(
      (JSON.parse(payload) as { userId: string | null }).userId,
    ).toBeNull();
  });

  // Bir Promise `throw 'string'` ile de reddedilebilir — filtre bunu da
  // buraya geçirir, patlamamalı.
  it('Error olmayan bir değerle de çalışır', () => {
    tracker.captureException('düz bir string', context);

    const [payload] = errorSpy.mock.calls[0] as [string, string | undefined];
    expect((JSON.parse(payload) as { message: string }).message).toBe(
      'düz bir string',
    );
    expect(
      (errorSpy.mock.calls[0] as [string, string | undefined])[1],
    ).toBeUndefined();
  });
});
