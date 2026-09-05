import { describe, expect, it } from 'vitest';
import { isPlausibleEmail } from './email.util';

describe('isPlausibleEmail', () => {
  it('accepts a plausible email address', () => {
    expect(isPlausibleEmail('admin@example.com')).toBe(true);
  });

  it('trims surrounding whitespace before checking', () => {
    expect(isPlausibleEmail('  admin@example.com  ')).toBe(true);
  });

  it('rejects a value with no @', () => {
    expect(isPlausibleEmail('not-an-email')).toBe(false);
  });

  it('rejects a value with no domain extension', () => {
    expect(isPlausibleEmail('admin@example')).toBe(false);
  });

  it('rejects an empty string', () => {
    expect(isPlausibleEmail('')).toBe(false);
  });

  it('rejects whitespace-only input', () => {
    expect(isPlausibleEmail('   ')).toBe(false);
  });

  it('rejects a value containing a space', () => {
    expect(isPlausibleEmail('admin @example.com')).toBe(false);
  });
});
