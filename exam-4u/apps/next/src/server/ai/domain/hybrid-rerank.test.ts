import { describe, expect, it } from 'vitest';
import { cosineSimilarity, fuseScore, lexicalScore, rerankFuseAndFilter, tokenize } from './hybrid-rerank';

/** Ported verbatim from `legacy/api/src/ai/domain/hybrid-rerank.spec.ts` (jest -> vitest, identical
 * assertions — this module was ported byte-for-byte, so its test suite is too). */

describe('cosineSimilarity', () => {
  it('returns 1 for identical vectors', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
  });

  it('returns 0 for orthogonal vectors', () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0, 5);
  });

  it('returns -1 for opposite vectors', () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1, 5);
  });

  it('returns 0 (not NaN) for a zero-magnitude vector rather than dividing by zero', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('tokenize', () => {
  it('lowercases, strips punctuation, and splits into words', () => {
    expect(tokenize('Hello, World! Photosynthesis-101.')).toEqual(['hello', 'world', 'photosynthesis', '101']);
  });

  it('drops common stopwords', () => {
    expect(tokenize('the quick fox and the lazy dog')).toEqual(['quick', 'fox', 'lazy', 'dog']);
  });

  it('returns [] for empty/whitespace-only text', () => {
    expect(tokenize('   ')).toEqual([]);
    expect(tokenize('')).toEqual([]);
  });
});

describe('lexicalScore', () => {
  it('returns 0 when there is no term overlap at all', () => {
    expect(lexicalScore(tokenize('photosynthesis energy'), 'unrelated topic about rocks')).toBe(0);
  });

  it('returns 0 for empty query terms or empty text', () => {
    expect(lexicalScore([], 'some text')).toBe(0);
    expect(lexicalScore(tokenize('query'), '')).toBe(0);
  });

  it('scores higher when more distinct query terms are covered', () => {
    const queryTerms = tokenize('photosynthesis chlorophyll energy');
    const fullMatch = lexicalScore(queryTerms, 'photosynthesis chlorophyll energy conversion');
    const partialMatch = lexicalScore(queryTerms, 'photosynthesis conversion only');
    expect(fullMatch).toBeGreaterThan(partialMatch);
  });

  it('never exceeds 1 even with heavy repetition of a single term', () => {
    const queryTerms = tokenize('quasar');
    const repeated = 'quasar '.repeat(50);
    expect(lexicalScore(queryTerms, repeated)).toBeLessThanOrEqual(1);
  });

  it('is case-insensitive', () => {
    const queryTerms = tokenize('Photosynthesis');
    expect(lexicalScore(queryTerms, 'PHOTOSYNTHESIS is a process')).toBeGreaterThan(0);
  });
});

describe('fuseScore', () => {
  it('with lexicalWeight 0, returns exactly the dense score', () => {
    expect(fuseScore(0.8, 0.1, 0)).toBeCloseTo(0.8, 5);
  });

  it('with lexicalWeight 1, returns exactly the lexical score', () => {
    expect(fuseScore(0.8, 0.1, 1)).toBeCloseTo(0.1, 5);
  });

  it('blends proportionally at an intermediate weight', () => {
    expect(fuseScore(1, 0, 0.5)).toBeCloseTo(0.5, 5);
  });
});

describe('rerankFuseAndFilter', () => {
  it('sorts by fused score descending, reordering when the lexical signal disagrees with dense order', () => {
    const result = rerankFuseAndFilter(
      [
        { id: 'a', denseScore: 0.9, text: 'no overlap with the query at all', payload: { name: 'a' } },
        { id: 'b', denseScore: 0.3, text: 'zephyr zephyr zephyr distinctive term', payload: { name: 'b' } },
      ],
      { queryText: 'zephyr', lexicalWeight: 0.7, relevanceFloor: 0, topK: 2 },
    );
    expect(result[0].payload.name).toBe('b');
  });

  it('excludes candidates at or below the relevance floor', () => {
    const result = rerankFuseAndFilter(
      [
        { id: 'a', denseScore: 0.9, text: 'strong match text', payload: { name: 'a' } },
        { id: 'b', denseScore: 0.05, text: 'weak match text', payload: { name: 'b' } },
      ],
      { queryText: 'strong match', lexicalWeight: 0.35, relevanceFloor: 0.2, topK: 5 },
    );
    expect(result.map((r) => r.payload.name)).toEqual(['a']);
  });

  it('a fused score exactly equal to the floor is excluded (floor is exclusive, ">", not ">=")', () => {
    const result = rerankFuseAndFilter(
      [{ id: 'a', denseScore: 0.5, text: 'irrelevant text', payload: {} }],
      { queryText: 'query with no overlap', lexicalWeight: 0, relevanceFloor: 0.5, topK: 5 },
    );
    expect(result).toHaveLength(0);
  });

  it('truncates to topK even when more candidates clear the floor', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({
      id: `c${i}`,
      denseScore: 0.5 + i * 0.01,
      text: 'matching text',
      payload: { i },
    }));
    const result = rerankFuseAndFilter(candidates, { queryText: 'matching', lexicalWeight: 0.2, relevanceFloor: 0, topK: 3 });
    expect(result).toHaveLength(3);
  });

  it('returns [] for an empty candidate list', () => {
    expect(rerankFuseAndFilter([], { queryText: 'q', lexicalWeight: 0.5, relevanceFloor: 0, topK: 5 })).toEqual([]);
  });
});
