import { HttpErrorResponse, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { throwError, of, firstValueFrom } from 'rxjs';
import { errorEnvelopeInterceptor } from './error-envelope.interceptor';

describe('errorEnvelopeInterceptor', () => {
  const req = new HttpRequest('GET', '/api/tenants');

  it('rethrows an HttpErrorResponse as an AppClientError', async () => {
    const next: HttpHandlerFn = () =>
      throwError(() => new HttpErrorResponse({ status: 403, error: { error: { code: 'TENANT_FORBIDDEN' } } })) as never;

    await TestBed.runInInjectionContext(async () => {
      await expect(firstValueFrom(errorEnvelopeInterceptor(req, next))).rejects.toMatchObject({
        code: 'TENANT_FORBIDDEN',
        status: 403,
      });
    });
  });

  it('passes through non-HttpErrorResponse errors untouched', async () => {
    const boom = new Error('boom');
    const next: HttpHandlerFn = () => throwError(() => boom) as never;

    await TestBed.runInInjectionContext(async () => {
      await expect(firstValueFrom(errorEnvelopeInterceptor(req, next))).rejects.toBe(boom);
    });
  });

  it('passes successful responses through unchanged', async () => {
    const next: HttpHandlerFn = () => of({ ok: true }) as never;

    await TestBed.runInInjectionContext(async () => {
      const result = await firstValueFrom(errorEnvelopeInterceptor(req, next));
      expect(result).toEqual({ ok: true });
    });
  });
});
