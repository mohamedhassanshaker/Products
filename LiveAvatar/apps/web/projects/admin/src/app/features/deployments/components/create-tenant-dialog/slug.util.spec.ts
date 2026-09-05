import { SLUG_PATTERN, slugify } from './slug.util';

describe('slugify', () => {
  it('lowercases and hyphenates spaces', () => {
    expect(slugify('Acme Corp')).toBe('acme-corp');
  });

  it('strips characters outside [a-z0-9-]', () => {
    expect(slugify("Acme! Corp's & Co.")).toBe('acme-corps-co');
  });

  it('prefixes with "d" when the result starts with a digit', () => {
    expect(slugify('123 Startup')).toBe('d123-startup');
  });

  it('caps the length at 48 characters', () => {
    const longName = 'a'.repeat(60);
    expect(slugify(longName).length).toBe(48);
  });

  it('collapses repeated separators and trims leading/trailing hyphens', () => {
    expect(slugify('  --Acme   Corp--  ')).toBe('acme-corp');
  });
});

describe('SLUG_PATTERN', () => {
  it('accepts a valid slug', () => {
    expect(SLUG_PATTERN.test('acme-corp')).toBe(true);
  });

  it('rejects a slug starting with a digit', () => {
    expect(SLUG_PATTERN.test('1acme')).toBe(false);
  });

  it('rejects a too-short slug', () => {
    expect(SLUG_PATTERN.test('a')).toBe(false);
  });
});
