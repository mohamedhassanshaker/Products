import { describe, expect, it } from 'vitest';
import { isValidCatalogKey } from './catalog-key.util';

describe('isValidCatalogKey', () => {
  it('accepts a simple lowercase key', () => {
    expect(isValidCatalogKey('pro')).toBe(true);
  });

  it('accepts dot/hyphen/underscore-separated segments', () => {
    expect(isValidCatalogKey('exams.create')).toBe(true);
    expect(isValidCatalogKey('full-bank-assessment')).toBe(true);
    expect(isValidCatalogKey('attempts_monthly')).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidCatalogKey('')).toBe(false);
  });

  it('rejects uppercase characters', () => {
    expect(isValidCatalogKey('Exams.Create')).toBe(false);
  });

  it('rejects a leading, trailing, or doubled separator', () => {
    expect(isValidCatalogKey('.exams')).toBe(false);
    expect(isValidCatalogKey('exams.')).toBe(false);
    expect(isValidCatalogKey('exams..create')).toBe(false);
  });

  it('rejects whitespace/special characters', () => {
    expect(isValidCatalogKey('exams create')).toBe(false);
    expect(isValidCatalogKey('exams/create')).toBe(false);
  });

  it('rejects a key over 100 characters', () => {
    expect(isValidCatalogKey('a'.repeat(101))).toBe(false);
  });

  it('accepts a key at exactly 100 characters', () => {
    expect(isValidCatalogKey('a'.repeat(100))).toBe(true);
  });
});
