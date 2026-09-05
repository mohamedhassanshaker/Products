import { AppError } from '../../../common/errors/app-error';
import { assertTenantName, assertTenantSlug, assertTenantStatus } from './validation';

describe('tenants domain validation', () => {
  describe('assertTenantName', () => {
    it('trims and returns a valid name', () => {
      expect(assertTenantName('  Acme Corp  ')).toBe('Acme Corp');
    });

    it('rejects an empty name', () => {
      expect(() => assertTenantName('   ')).toThrow(AppError);
      try {
        assertTenantName('');
      } catch (err) {
        expect((err as AppError).code).toBe('TENANT_NAME_INVALID');
        expect((err as AppError).httpStatus).toBe(400);
      }
    });

    it('rejects a name over 80 characters', () => {
      expect(() => assertTenantName('a'.repeat(81))).toThrow(AppError);
    });

    it('accepts exactly 80 characters', () => {
      expect(assertTenantName('a'.repeat(80))).toHaveLength(80);
    });
  });

  describe('assertTenantSlug', () => {
    it.each(['acme', 'acme-corp', 'a1', 'a'.repeat(48)])('accepts valid slug %s', (slug) => {
      expect(assertTenantSlug(slug)).toBe(slug);
    });

    it.each(['Acme', '1acme', 'acme_corp', 'a', 'a'.repeat(49), ''])(
      'rejects invalid slug %s',
      (slug) => {
        expect(() => assertTenantSlug(slug)).toThrow(AppError);
      },
    );

    it('carries the TENANT_SLUG_INVALID code', () => {
      try {
        assertTenantSlug('BAD SLUG');
      } catch (err) {
        expect((err as AppError).code).toBe('TENANT_SLUG_INVALID');
      }
    });
  });

  describe('assertTenantStatus', () => {
    it.each(['active', 'paused'])('accepts %s', (status) => {
      expect(assertTenantStatus(status)).toBe(status);
    });

    it.each(['ACTIVE', 'disabled', undefined, null, 1])('rejects %s', (status) => {
      expect(() => assertTenantStatus(status)).toThrow(AppError);
    });
  });
});
