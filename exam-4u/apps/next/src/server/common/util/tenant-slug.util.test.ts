import { describe, expect, it } from 'vitest';
import { generateTenantSchemaName, isValidSubdomainSlug } from './tenant-slug.util';

describe('isValidSubdomainSlug', () => {
  it('accepts a simple lowercase alphanumeric slug', () => {
    expect(isValidSubdomainSlug('acme')).toBe(true);
  });

  it('accepts hyphens between alphanumeric segments', () => {
    expect(isValidSubdomainSlug('acme-medical')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidSubdomainSlug('')).toBe(false);
  });

  it('rejects a leading hyphen', () => {
    expect(isValidSubdomainSlug('-acme')).toBe(false);
  });

  it('rejects a trailing hyphen', () => {
    expect(isValidSubdomainSlug('acme-')).toBe(false);
  });

  it('rejects consecutive hyphens', () => {
    expect(isValidSubdomainSlug('acme--medical')).toBe(false);
  });

  it('rejects uppercase characters', () => {
    expect(isValidSubdomainSlug('Acme')).toBe(false);
  });

  it('rejects a slug over 63 characters', () => {
    expect(isValidSubdomainSlug('a'.repeat(64))).toBe(false);
  });

  it('accepts a slug at exactly 63 characters', () => {
    expect(isValidSubdomainSlug('a'.repeat(63))).toBe(true);
  });
});

describe('generateTenantSchemaName', () => {
  it('produces a name matching the t_{slug}_{8hex} shape', () => {
    const name = generateTenantSchemaName('acme-medical');
    expect(name).toMatch(/^t_acme_medical_[0-9a-f]{8}$/);
  });

  it('folds hyphens to underscores only in the schema-name segment', () => {
    const name = generateTenantSchemaName('a-b-c');
    expect(name.startsWith('t_a_b_c_')).toBe(true);
  });

  it('truncates a long slug to 20 characters before appending the suffix', () => {
    const longSlug = 'a'.repeat(30);
    const name = generateTenantSchemaName(longSlug);
    const withoutPrefixSuffix = name.replace(/^t_/, '').replace(/_[0-9a-f]{8}$/, '');
    expect(withoutPrefixSuffix.length).toBeLessThanOrEqual(20);
  });

  it('generates a different suffix on every call (no collision across repeated calls)', () => {
    const first = generateTenantSchemaName('acme');
    const second = generateTenantSchemaName('acme');
    expect(first).not.toBe(second);
  });
});
