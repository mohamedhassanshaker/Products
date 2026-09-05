import { describe, expect, it } from 'vitest';
import { selectDiverse, NEAR_DUPLICATE_THRESHOLD, type DiversityCandidate } from './diversity-selection';

describe('selectDiverse (FR-CUR-6, NEAR_DUPLICATE_THRESHOLD 0.93)', () => {
  it('returns [] for an empty candidate pool', () => {
    expect(selectDiverse([], 5)).toEqual([]);
  });

  it('returns [] when count <= 0', () => {
    const candidates: DiversityCandidate<string>[] = [{ item: 'a', embedding: [1, 0] }];
    expect(selectDiverse(candidates, 0)).toEqual([]);
    expect(selectDiverse(candidates, -1)).toEqual([]);
  });

  it('always selects the first (pre-sorted, highest-confidence) candidate as the seed', () => {
    const candidates: DiversityCandidate<string>[] = [
      { item: 'seed', embedding: [1, 0] },
      { item: 'other', embedding: [0, 1] },
    ];
    const result = selectDiverse(candidates, 1);
    expect(result).toEqual(['seed']);
  });

  it('greedily picks the farthest remaining candidate from everything already selected', () => {
    const candidates: DiversityCandidate<string>[] = [
      { item: 'seed', embedding: [1, 0] },
      { item: 'close', embedding: [0.5, 0.866] },
      { item: 'far', embedding: [0, 1] },
    ];
    const result = selectDiverse(candidates, 2);
    expect(result).toEqual(['seed', 'far']);
  });

  it('never selects a candidate whose similarity to an already-selected item is >= NEAR_DUPLICATE_THRESHOLD, even if it is otherwise the farthest remaining pick', () => {
    const candidates: DiversityCandidate<string>[] = [
      { item: 'seed', embedding: [1, 0] },
      { item: 'dup', embedding: [0.999, 0.045] },
    ];
    const result = selectDiverse(candidates, 2);
    expect(result).toEqual(['seed']);
  });

  it('caps selection at count even when more non-duplicate candidates remain', () => {
    const candidates: DiversityCandidate<string>[] = [
      { item: 'a', embedding: [1, 0, 0, 0] },
      { item: 'b', embedding: [0, 1, 0, 0] },
      { item: 'c', embedding: [0, 0, 1, 0] },
      { item: 'd', embedding: [0, 0, 0, 1] },
    ];
    const result = selectDiverse(candidates, 2);
    expect(result).toHaveLength(2);
  });

  it('returns fewer than count items when every remaining candidate is a near-duplicate of something already selected', () => {
    const candidates: DiversityCandidate<string>[] = [
      { item: 'seed', embedding: [1, 0] },
      { item: 'dup1', embedding: [0.999, 0.045] },
      { item: 'dup2', embedding: [0.998, 0.063] },
    ];
    const result = selectDiverse(candidates, 3);
    expect(result).toEqual(['seed']);
  });

  it('sanity-checks the near-duplicate boundary itself is >= 0.93 (documented constant)', () => {
    expect(NEAR_DUPLICATE_THRESHOLD).toBe(0.93);
  });
});
