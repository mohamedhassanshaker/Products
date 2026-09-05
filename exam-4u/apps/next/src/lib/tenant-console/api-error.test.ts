import { describe, expect, it } from 'vitest';
import { isTenantApiError, TenantApiError } from './api-error';

describe('isTenantApiError', () => {
  it('returns true for a real TenantApiError instance', () => {
    expect(isTenantApiError(new TenantApiError(403, 'NOT_CURRICULUM_OWNER', 'nope'))).toBe(true);
  });

  it('returns false for a plain Error or any other thrown value', () => {
    expect(isTenantApiError(new Error('plain'))).toBe(false);
    expect(isTenantApiError('a string')).toBe(false);
    expect(isTenantApiError(undefined)).toBe(false);
  });
});
