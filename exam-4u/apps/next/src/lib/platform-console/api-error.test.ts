import { describe, expect, it } from 'vitest';
import { isPlatformApiError, PlatformApiError } from './api-error';

describe('isPlatformApiError', () => {
  it('returns true for a real PlatformApiError instance', () => {
    expect(isPlatformApiError(new PlatformApiError(409, 'INVALID_TENANT_STATE', 'nope'))).toBe(true);
  });

  it('returns false for a plain Error or any other thrown value', () => {
    expect(isPlatformApiError(new Error('plain'))).toBe(false);
    expect(isPlatformApiError('a string')).toBe(false);
    expect(isPlatformApiError(undefined)).toBe(false);
  });
});
