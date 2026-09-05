import { HttpErrorResponse } from '@angular/common/http';
import { isAppErrorCode, toAppClientError } from './error-envelope';

function httpError(status: number, error: unknown): HttpErrorResponse {
  return new HttpErrorResponse({ status, error });
}

describe('isAppErrorCode', () => {
  it('accepts a known code', () => {
    expect(isAppErrorCode('AUTH_INVALID_CREDENTIALS')).toBe(true);
  });

  it('rejects an unknown string', () => {
    expect(isAppErrorCode('NOT_A_REAL_CODE')).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isAppErrorCode(42)).toBe(false);
    expect(isAppErrorCode(undefined)).toBe(false);
  });
});

describe('toAppClientError', () => {
  it('maps status 0 to NETWORK_ERROR', () => {
    const result = toAppClientError(httpError(0, null));
    expect(result).toEqual({ status: 0, code: 'NETWORK_ERROR', message: 'Network error.', details: {} });
  });

  it('maps a known envelope code, preferring the server message', () => {
    const result = toAppClientError(
      httpError(401, { error: { code: 'AUTH_INVALID_CREDENTIALS', message: 'Email or password is incorrect.', details: {} } }),
    );
    expect(result).toEqual({
      status: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
      details: {},
    });
  });

  it('falls back to the local message map when the server omits a message', () => {
    const result = toAppClientError(httpError(429, { error: { code: 'AUTH_RATE_LIMITED' } }));
    expect(result.code).toBe('AUTH_RATE_LIMITED');
    expect(result.message).toBe('Too many login attempts. Try again in a few minutes.');
  });

  it('carries details through when present', () => {
    const result = toAppClientError(
      httpError(409, { error: { code: 'TENANT_CONFLICT', message: 'Conflict', details: { retryable: true } } }),
    );
    expect(result.details).toEqual({ retryable: true });
  });

  it('maps an unrecognized code to UNKNOWN_ERROR', () => {
    const result = toAppClientError(httpError(500, { error: { code: 'SOMETHING_NEW' } }));
    expect(result.code).toBe('UNKNOWN_ERROR');
  });

  it('maps a body with no envelope shape to UNKNOWN_ERROR', () => {
    const result = toAppClientError(httpError(502, 'Bad Gateway'));
    expect(result.code).toBe('UNKNOWN_ERROR');
    expect(result.status).toBe(502);
  });
});
