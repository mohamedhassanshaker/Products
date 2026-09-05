import { describe, expect, it } from 'vitest';
import { QuestionBankShortfallError, selectAdaptiveQuestions, shuffleInPlace } from './adaptive-selection';

/** A deterministic RNG generator for reproducible shuffle assertions — cycles through a fixed sequence
 * of [0,1) values rather than relying on `Math.random`. */
function seededRng(seq: number[]): () => number {
  let i = 0;
  return () => seq[i++ % seq.length];
}

describe('selectAdaptiveQuestions', () => {
  it('throws QuestionBankShortfallError when the bank is smaller than requiredCount', () => {
    const candidates = [{ questionKey: 'q1' }, { questionKey: 'q2' }];
    expect(() => selectAdaptiveQuestions(candidates, new Map(), 3)).toThrow(QuestionBankShortfallError);
  });

  it('QuestionBankShortfallError carries available/required', () => {
    const candidates = [{ questionKey: 'q1' }];
    try {
      selectAdaptiveQuestions(candidates, new Map(), 5);
      expect.fail('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(QuestionBankShortfallError);
      expect((err as QuestionBankShortfallError).available).toBe(1);
      expect((err as QuestionBankShortfallError).required).toBe(5);
    }
  });

  it('prioritizes never-attempted, then previously-wrong, then previously-correct', () => {
    const candidates = [
      { questionKey: 'correct-1' },
      { questionKey: 'wrong-1' },
      { questionKey: 'never-1' },
      { questionKey: 'never-2' },
    ];
    const history = new Map([
      ['correct-1', true],
      ['wrong-1', false],
    ]);

    const selected = selectAdaptiveQuestions(candidates, history, 4, Math.random);
    const keys = selected.map((c) => c.questionKey);
    // never-attempted tier (never-1/never-2, any order) must both precede wrong-1, which must precede
    // correct-1 — the priority ordering is deterministic even though within-tier order is shuffled.
    const neverIdx = [keys.indexOf('never-1'), keys.indexOf('never-2')];
    const wrongIdx = keys.indexOf('wrong-1');
    const correctIdx = keys.indexOf('correct-1');
    expect(Math.max(...neverIdx)).toBeLessThan(wrongIdx);
    expect(wrongIdx).toBeLessThan(correctIdx);
  });

  it('slices to exactly requiredCount even when more candidates are available', () => {
    const candidates = Array.from({ length: 10 }, (_, i) => ({ questionKey: `q${i}` }));
    const selected = selectAdaptiveQuestions(candidates, new Map(), 3);
    expect(selected).toHaveLength(3);
  });

  it('a key absent from history is treated as never-attempted (highest priority)', () => {
    const candidates = [{ questionKey: 'known-correct' }, { questionKey: 'unknown' }];
    const history = new Map([['known-correct', true]]);
    const selected = selectAdaptiveQuestions(candidates, history, 2);
    expect(selected[0].questionKey).toBe('unknown');
    expect(selected[1].questionKey).toBe('known-correct');
  });

  it('uses the injected RNG deterministically', () => {
    const candidates = [{ questionKey: 'a' }, { questionKey: 'b' }, { questionKey: 'c' }];
    const rng1 = seededRng([0.9, 0.1]);
    const rng2 = seededRng([0.9, 0.1]);
    const result1 = selectAdaptiveQuestions(candidates, new Map(), 3, rng1);
    const result2 = selectAdaptiveQuestions(candidates, new Map(), 3, rng2);
    expect(result1.map((c) => c.questionKey)).toEqual(result2.map((c) => c.questionKey));
  });
});

describe('shuffleInPlace', () => {
  it('returns the same array reference', () => {
    const arr = [1, 2, 3];
    expect(shuffleInPlace(arr)).toBe(arr);
  });

  it('preserves the same set of elements', () => {
    const arr = [1, 2, 3, 4, 5];
    const shuffled = shuffleInPlace([...arr]);
    expect(shuffled.slice().sort()).toEqual(arr.slice().sort());
  });

  it('a constant-0 RNG produces the fully-reversed order (Fisher-Yates identity check)', () => {
    const arr = [1, 2, 3, 4];
    const shuffled = shuffleInPlace(arr, () => 0);
    // With rng() always returning 0, j = 0 every iteration, producing a specific deterministic
    // permutation — asserting the exact result locks in the algorithm's behavior.
    expect(shuffled).toEqual([2, 3, 4, 1]);
  });

  it('handles an empty array without throwing', () => {
    expect(shuffleInPlace([])).toEqual([]);
  });

  it('handles a single-element array without throwing', () => {
    expect(shuffleInPlace([42])).toEqual([42]);
  });
});
