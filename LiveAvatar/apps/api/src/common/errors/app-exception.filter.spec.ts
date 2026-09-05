import { HttpException } from '@nestjs/common';
import { AppError, TenantScopeViolationError } from './app-error';
import { AppExceptionFilter } from './app-exception.filter';

function makeHost() {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
  return { host: { switchToHttp: () => ({ getResponse: () => res }) } as never, res };
}

describe('AppExceptionFilter', () => {
  const filter = new AppExceptionFilter();

  it('renders an AppError as its code/status/message/details', () => {
    const { host, res } = makeHost();
    filter.catch(AppError.notFound('TENANT_NOT_FOUND'), host);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: { code: 'TENANT_NOT_FOUND', message: expect.any(String), details: {} },
    });
  });

  it('renders a TenantScopeViolationError as a 500 with a request id, never the internal message', () => {
    const { host, res } = makeHost();
    filter.catch(new TenantScopeViolationError('Session'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.details.request_id).toBeDefined();
  });

  it('renders a Nest HttpException with a string response', () => {
    const { host, res } = makeHost();
    filter.catch(new HttpException('bad', 400), host);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'INTERNAL_ERROR', message: 'bad', details: {} } });
  });

  it('maps a 401 HttpException to AUTH_UNAUTHORIZED', () => {
    const { host, res } = makeHost();
    filter.catch(new HttpException('nope', 401), host);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error.code).toBe('AUTH_UNAUTHORIZED');
  });

  it('renders an HttpException with an object response containing message', () => {
    const { host, res } = makeHost();
    filter.catch(new HttpException({ message: 'obj-message' }, 400), host);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error.message).toBe('obj-message');
  });

  it('renders an HttpException with a non-string message as the fallback sentence', () => {
    const { host, res } = makeHost();
    filter.catch(new HttpException({ message: { nested: true } }, 400), host);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error.message).toBe('An unexpected error occurred.');
  });

  it('renders an unmapped exception as 500 INTERNAL_ERROR with a request id', () => {
    const { host, res } = makeHost();
    filter.catch(new Error('unexpected'), host);
    expect(res.status).toHaveBeenCalledWith(500);
    const payload = res.json.mock.calls[0][0];
    expect(payload.error.code).toBe('INTERNAL_ERROR');
    expect(payload.error.details.request_id).toBeDefined();
  });
});
