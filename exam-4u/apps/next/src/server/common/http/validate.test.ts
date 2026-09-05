import { describe, expect, it } from 'vitest';
import { ValidationFailedError } from '@/server/common/errors/domain-error';
import { parseJsonBody, requireEmail, requireIntFromQuery, requireString } from './validate';

describe('parseJsonBody', () => {
  it('parses a well-formed JSON object body', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ a: 1 }) });
    await expect(parseJsonBody(request)).resolves.toEqual({ a: 1 });
  });

  it('returns {} for an empty/malformed body rather than throwing', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'not json' });
    await expect(parseJsonBody(request)).resolves.toEqual({});
  });

  it('returns {} for a JSON array body (not an object)', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify([1, 2]) });
    await expect(parseJsonBody(request)).resolves.toEqual({});
  });

  it('returns {} for a JSON null body', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: 'null' });
    await expect(parseJsonBody(request)).resolves.toEqual({});
  });
});

describe('requireString', () => {
  it('accepts a string within bounds', () => {
    expect(requireString('hello', 'field', { min: 1, max: 10 })).toBe('hello');
  });

  it('rejects a non-string value', () => {
    expect(() => requireString(42, 'field')).toThrow(ValidationFailedError);
  });

  it('rejects a too-short string', () => {
    expect(() => requireString('', 'field', { min: 1 })).toThrow(ValidationFailedError);
  });

  it('rejects a too-long string', () => {
    expect(() => requireString('abc', 'field', { max: 2 })).toThrow(ValidationFailedError);
  });
});

describe('requireEmail', () => {
  it('accepts a plausible email', () => {
    expect(requireEmail('user@example.com')).toBe('user@example.com');
  });

  it('rejects a value with no @ sign', () => {
    expect(() => requireEmail('not-an-email')).toThrow(ValidationFailedError);
  });

  it('rejects a non-string value', () => {
    expect(() => requireEmail(123)).toThrow(ValidationFailedError);
  });
});

describe('requireIntFromQuery', () => {
  it('parses a well-formed integer query param', () => {
    expect(requireIntFromQuery('42', 'educationLevelId')).toBe(42);
  });

  it('rejects a missing (null) param rather than silently defaulting to 0', () => {
    expect(() => requireIntFromQuery(null, 'educationLevelId')).toThrow(ValidationFailedError);
  });

  it('rejects an empty-string param rather than silently defaulting to 0', () => {
    expect(() => requireIntFromQuery('', 'educationLevelId')).toThrow(ValidationFailedError);
  });

  it('rejects a non-numeric string', () => {
    expect(() => requireIntFromQuery('abc', 'educationLevelId')).toThrow(ValidationFailedError);
  });

  it('rejects a non-integer numeric string', () => {
    expect(() => requireIntFromQuery('12.5', 'educationLevelId')).toThrow(ValidationFailedError);
  });

  it('respects min/max bounds', () => {
    expect(() => requireIntFromQuery('0', 'educationLevelId', { min: 1 })).toThrow(ValidationFailedError);
  });
});
