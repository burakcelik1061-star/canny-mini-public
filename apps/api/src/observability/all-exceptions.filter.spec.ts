import {
  ArgumentsHost,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;
  let errorTracker: { captureException: jest.Mock };
  let json: jest.Mock;
  let status: jest.Mock;

  const REQUEST_ID = 'req-1';

  function hostFor(request: Record<string, unknown> = {}): ArgumentsHost {
    return {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({
          requestId: REQUEST_ID,
          method: 'POST',
          url: '/organizations/org-1/boards',
          ...request,
        }),
      }),
    } as unknown as ArgumentsHost;
  }

  beforeEach(() => {
    json = jest.fn();
    status = jest.fn().mockReturnValue({ json });
    errorTracker = { captureException: jest.fn() };
    filter = new AllExceptionsFilter(errorTracker);
  });

  it('HttpException’ın status kodunu ve mesajını korur', () => {
    filter.catch(new NotFoundException('Board bulunamadı'), hostFor());

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Board bulunamadı' }),
    );
  });

  // REGRESYON: apps/web bu `error` alanını okuyup "Pro'ya yükselt" CTA'sı
  // gösteriyor (bkz. lib/api.ts → parseErrorBody). Filtre gövdeyi
  // normalize etseydi CTA sessizce kaybolurdu.
  it('obje gövdeli bir HttpException’ın ek alanlarını (error kodu) korur', () => {
    const exception = new ForbiddenException({
      statusCode: 403,
      message: 'Free plan en fazla 1 board’a izin veriyor',
      error: 'PLAN_LIMIT_EXCEEDED',
    });

    filter.catch(exception, hostFor());

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'PLAN_LIMIT_EXCEEDED' }),
    );
  });

  it('validation hatasının message dizisini bozmaz', () => {
    filter.catch(
      new BadRequestException({
        statusCode: 400,
        message: ['email must be an email', 'password too short'],
        error: 'Bad Request',
      }),
      hostFor(),
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: ['email must be an email', 'password too short'],
      }),
    );
  });

  it('her yanıta requestId ekler', () => {
    filter.catch(new NotFoundException(), hostFor());

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: REQUEST_ID }),
    );
  });

  it('4xx hatalarını ErrorTracker’a BİLDİRMEZ (gürültü olurdu)', () => {
    filter.catch(new NotFoundException(), hostFor());
    filter.catch(new BadRequestException(), hostFor());
    filter.catch(new ForbiddenException(), hostFor());

    expect(errorTracker.captureException).not.toHaveBeenCalled();
  });

  it('beklenmeyen bir hatayı 500 yapar, ErrorTracker’a bildirir ve içeriğini SIZDIRMAZ', () => {
    const leaky = new Error('Prisma: connect ECONNREFUSED 10.0.0.5:5432');

    filter.catch(leaky, hostFor({ user: { sub: 'user-1' } }));

    expect(status).toHaveBeenCalledWith(500);
    // Ham mesaj istemciye gitmemeli.
    expect(json).toHaveBeenCalledWith({
      statusCode: 500,
      message: 'Beklenmeyen bir hata oluştu',
      requestId: REQUEST_ID,
    });
    // ...ama izleme tarafına TAM olarak gitmeli.
    expect(errorTracker.captureException).toHaveBeenCalledWith(
      leaky,
      expect.objectContaining({
        requestId: REQUEST_ID,
        method: 'POST',
        path: '/organizations/org-1/boards',
        userId: 'user-1',
        statusCode: 500,
      }),
    );
  });

  it('giriş yapılmamışsa userId undefined gider (patlamaz)', () => {
    filter.catch(new Error('bir şey'), hostFor());

    expect(errorTracker.captureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ userId: undefined }),
    );
  });
});
