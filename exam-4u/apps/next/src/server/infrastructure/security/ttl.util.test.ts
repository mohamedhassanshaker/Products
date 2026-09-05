import { describe, expect, it } from 'vitest';
import { parseTtlToSeconds } from './ttl.util';

describe('parseTtlToSeconds', () => {
  it('treats a bare integer as whole seconds', () => {
    expect(parseTtlToSeconds('3600')).toBe(3600);
  });

  it('parses minutes', () => {
    expect(parseTtlToSeconds('60m')).toBe(3600);
  });

  it('parses hours', () => {
    expect(parseTtlToSeconds('2h')).toBe(7200);
  });

  it('parses days', () => {
    expect(parseTtlToSeconds('7d')).toBe(604_800);
  });

  it('parses seconds explicitly', () => {
    expect(parseTtlToSeconds('45s')).toBe(45);
  });

  it('falls back to 3600 for an unparseable string', () => {
    expect(parseTtlToSeconds('not-a-ttl')).toBe(3600);
    expect(parseTtlToSeconds('')).toBe(3600);
    expect(parseTtlToSeconds('60x')).toBe(3600);
  });
});
