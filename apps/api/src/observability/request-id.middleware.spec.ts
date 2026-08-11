import type { NextFunction, Response } from 'express';
import {
  REQUEST_ID_HEADER,
  RequestIdMiddleware,
  type RequestWithId,
} from './request-id.middleware';

describe('RequestIdMiddleware', () => {
  let middleware: RequestIdMiddleware;
  let setHeader: jest.Mock;
  let next: NextFunction;

  function requestWith(headers: Record<string, unknown> = {}): RequestWithId {
    return { headers } as unknown as RequestWithId;
  }

  beforeEach(() => {
    middleware = new RequestIdMiddleware();
    setHeader = jest.fn();
    next = jest.fn();
  });

  const response = () => ({ setHeader }) as unknown as Response;

  it('id yoksa üretir, request’e ve yanıt başlığına koyar', () => {
    const req = requestWith();

    middleware.use(req, response(), next);

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
    expect(setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, req.requestId);
    expect(next).toHaveBeenCalled();
  });

  it('her istekte farklı bir id üretir', () => {
    const first = requestWith();
    const second = requestWith();

    middleware.use(first, response(), next);
    middleware.use(second, response(), next);

    expect(first.requestId).not.toBe(second.requestId);
  });

  // Gerçek bir kurulumda id'yi önündeki proxy üretmiş olabilir — üzerine
  // yazmak izleme zincirini koparırdı.
  it('gelen bir id’yi korur', () => {
    const req = requestWith({ [REQUEST_ID_HEADER]: 'upstream-id' });

    middleware.use(req, response(), next);

    expect(req.requestId).toBe('upstream-id');
  });

  it('boş/whitespace bir id’yi kabul etmez, yenisini üretir', () => {
    const req = requestWith({ [REQUEST_ID_HEADER]: '   ' });

    middleware.use(req, response(), next);

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('dizi olarak gelen bir başlığı (tekrarlanan header) yok sayar', () => {
    const req = requestWith({ [REQUEST_ID_HEADER]: ['a', 'b'] });

    middleware.use(req, response(), next);

    expect(req.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
