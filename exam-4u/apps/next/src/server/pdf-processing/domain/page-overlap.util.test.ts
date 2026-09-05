import { describe, expect, it } from 'vitest';
import { pageOverlapsRange, parseSourcePageRange } from './page-overlap.util';

describe('parseSourcePageRange (FR-PDF-11)', () => {
  it('parses a single page number', () => {
    expect(parseSourcePageRange('3')).toEqual({ start: 3, end: 3 });
  });

  it('parses an inclusive range, tolerating surrounding whitespace and spaces around the dash', () => {
    expect(parseSourcePageRange(' 3 - 5 ')).toEqual({ start: 3, end: 5 });
  });

  it('normalizes an inverted range rather than rejecting it', () => {
    expect(parseSourcePageRange('5-3')).toEqual({ start: 3, end: 5 });
  });

  it('degrades to null (never throws) for null/blank/unparsable/non-integer values', () => {
    expect(parseSourcePageRange(null)).toBeNull();
    expect(parseSourcePageRange('')).toBeNull();
    expect(parseSourcePageRange('pages 3 to 5')).toBeNull();
    expect(parseSourcePageRange('3.5')).toBeNull();
  });
});

describe('pageOverlapsRange (FR-PDF-11)', () => {
  it('matches a page inside an inclusive range, including both endpoints', () => {
    const range = { start: 3, end: 5 };
    expect(pageOverlapsRange(3, range)).toBe(true);
    expect(pageOverlapsRange(4, range)).toBe(true);
    expect(pageOverlapsRange(5, range)).toBe(true);
  });

  it('rejects a page outside the range', () => {
    expect(pageOverlapsRange(2, { start: 3, end: 5 })).toBe(false);
    expect(pageOverlapsRange(6, { start: 3, end: 5 })).toBe(false);
  });

  it('is false for a null (unparsable) range — one bad row never associates every image', () => {
    expect(pageOverlapsRange(1, null)).toBe(false);
  });

  it('composes with parseSourcePageRange for the real end-to-end rule (a 3-5 question picks up a page-4 image)', () => {
    expect(pageOverlapsRange(4, parseSourcePageRange('3-5'))).toBe(true);
  });
});
