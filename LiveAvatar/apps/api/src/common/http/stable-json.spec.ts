import { hashRequestBody, stableStringify } from './stable-json';

describe('stableStringify', () => {
  it('returns "null" for null and undefined', () => {
    expect(stableStringify(null)).toBe('null');
    expect(stableStringify(undefined)).toBe('null');
  });

  it('sorts object keys so key order does not affect the hash', () => {
    expect(stableStringify({ b: 1, a: 2 })).toBe(stableStringify({ a: 2, b: 1 }));
  });

  it('stringifies arrays element-wise', () => {
    expect(stableStringify([1, 'a', null])).toBe('[1,"a",null]');
  });

  it('stringifies primitives via JSON.stringify', () => {
    expect(stableStringify('x')).toBe('"x"');
    expect(stableStringify(42)).toBe('42');
  });

  it('recurses into nested objects', () => {
    expect(stableStringify({ b: { d: 1, c: 2 }, a: 1 })).toBe('{"a":1,"b":{"c":2,"d":1}}');
  });
});

describe('hashRequestBody', () => {
  it('produces the same digest regardless of key order', () => {
    expect(hashRequestBody({ b: 1, a: 2 })).toBe(hashRequestBody({ a: 2, b: 1 }));
  });

  it('produces a 64-char hex digest', () => {
    expect(hashRequestBody({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different digests for different bodies', () => {
    expect(hashRequestBody({ x: 1 })).not.toBe(hashRequestBody({ x: 2 }));
  });
});
