import { describe, expect, it } from 'vitest';
import { parseRangeHeader } from './range.util';

describe('parseRangeHeader', () => {
  it('returns undefined when there is no Range header', () => {
    expect(parseRangeHeader(undefined, 1000)).toBeUndefined();
    expect(parseRangeHeader(null, 1000)).toBeUndefined();
  });

  it('returns undefined for a non-bytes unit (RFC 9110: unrecognized unit is ignored, not an error)', () => {
    expect(parseRangeHeader('items=0-5', 1000)).toBeUndefined();
  });

  it('resolves a simple start-end range', () => {
    expect(parseRangeHeader('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 });
  });

  it('resolves an open-ended range (bytes=500-)', () => {
    expect(parseRangeHeader('bytes=500-', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('resolves a suffix range (bytes=-500 = last 500 bytes)', () => {
    expect(parseRangeHeader('bytes=-500', 1000)).toEqual({ start: 500, end: 999 });
  });

  it('clamps a suffix range longer than the whole file to the whole file', () => {
    expect(parseRangeHeader('bytes=-5000', 1000)).toEqual({ start: 0, end: 999 });
  });

  it('clamps an end past the total size down to the last byte', () => {
    expect(parseRangeHeader('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 });
  });

  it('only honors the first range of a multi-range request', () => {
    expect(parseRangeHeader('bytes=0-99,200-299', 1000)).toEqual({ start: 0, end: 99 });
  });

  it('returns "unsatisfiable" for a malformed spec (neither bound present)', () => {
    expect(parseRangeHeader('bytes=-', 1000)).toBe('unsatisfiable');
  });

  it('returns "unsatisfiable" for a non-numeric spec', () => {
    expect(parseRangeHeader('bytes=abc-def', 1000)).toBe('unsatisfiable');
  });

  it('returns "unsatisfiable" when start > end', () => {
    expect(parseRangeHeader('bytes=500-100', 1000)).toBe('unsatisfiable');
  });

  it('returns "unsatisfiable" when start >= totalSize', () => {
    expect(parseRangeHeader('bytes=1000-1999', 1000)).toBe('unsatisfiable');
  });

  it('returns "unsatisfiable" for a zero-length suffix (bytes=-0 resolves to start > end)', () => {
    expect(parseRangeHeader('bytes=-0', 1000)).toBe('unsatisfiable');
  });
});
