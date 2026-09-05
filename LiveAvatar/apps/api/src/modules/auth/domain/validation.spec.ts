import { AppError } from '../../../common/errors/app-error';
import { assertPasswordPolicy, normalizeEmail } from './validation';

describe('auth domain validation', () => {
  describe('normalizeEmail', () => {
    it('trims and lowercases a valid email', () => {
      expect(normalizeEmail('  User@Example.com  ')).toBe('user@example.com');
    });

    it('rejects an empty email', () => {
      expect(() => normalizeEmail('   ')).toThrow(AppError);
    });

    it('rejects an email without an @', () => {
      expect(() => normalizeEmail('not-an-email')).toThrow(AppError);
    });

    it('rejects an email over 254 characters', () => {
      const long = `${'a'.repeat(250)}@b.com`;
      expect(() => normalizeEmail(long)).toThrow(AppError);
    });

    it('carries the AUTH_EMAIL_INVALID code', () => {
      try {
        normalizeEmail('bad');
      } catch (err) {
        expect((err as AppError).code).toBe('AUTH_EMAIL_INVALID');
      }
    });
  });

  describe('assertPasswordPolicy', () => {
    it('accepts a password with a letter and a digit, >= 8 chars', () => {
      expect(() => assertPasswordPolicy('abcd1234')).not.toThrow();
    });

    it('rejects a password under 8 characters', () => {
      expect(() => assertPasswordPolicy('a1')).toThrow(AppError);
    });

    it('rejects a password with no digit', () => {
      expect(() => assertPasswordPolicy('abcdefgh')).toThrow(AppError);
    });

    it('rejects a password with no letter', () => {
      expect(() => assertPasswordPolicy('12345678')).toThrow(AppError);
    });
  });
});
