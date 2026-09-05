import { describe, expect, it } from 'vitest';
import { COVERED_CONCEPTS_CAP, mergeCoveredConcepts } from './covered-concepts';

describe('mergeCoveredConcepts (FR-PDF-4 carry-forward)', () => {
  it('appends genuinely new concepts in order', () => {
    expect(mergeCoveredConcepts(['photosynthesis'], ['mitosis', 'osmosis'])).toEqual(['photosynthesis', 'mitosis', 'osmosis']);
  });

  it('de-duplicates case-insensitively, moving the repeat to the end (most recently covered)', () => {
    expect(mergeCoveredConcepts(['Photosynthesis', 'mitosis'], ['PHOTOSYNTHESIS'])).toEqual(['mitosis', 'PHOTOSYNTHESIS']);
  });

  it('ignores blank/whitespace-only/null/undefined concept strings rather than merging empties', () => {
    expect(mergeCoveredConcepts(['a'], ['', '   ', null, undefined])).toEqual(['a']);
  });

  it('trims surrounding whitespace before merging', () => {
    expect(mergeCoveredConcepts([], ['  osmosis  '])).toEqual(['osmosis']);
  });

  it('evicts the OLDEST entries first once the cap is exceeded', () => {
    const existing = Array.from({ length: COVERED_CONCEPTS_CAP }, (_, i) => `c${i}`);
    const merged = mergeCoveredConcepts(existing, ['brand-new']);
    expect(merged).toHaveLength(COVERED_CONCEPTS_CAP);
    expect(merged[0]).toBe('c1'); // c0 evicted
    expect(merged.at(-1)).toBe('brand-new');
  });

  it('never mutates the caller\'s existing array', () => {
    const existing = ['a'];
    mergeCoveredConcepts(existing, ['b']);
    expect(existing).toEqual(['a']);
  });

  it('returns an empty list for empty input', () => {
    expect(mergeCoveredConcepts([], [])).toEqual([]);
  });
});
