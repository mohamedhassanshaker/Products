import { describe, expect, it } from 'vitest';
import { deriveDifficultyTier } from './full-bank-assessment.types';

describe('deriveDifficultyTier (FR-PDF-13)', () => {
  it('buckets blooms 1-2 as Easy', () => {
    expect(deriveDifficultyTier(1)).toBe('Easy');
    expect(deriveDifficultyTier(2)).toBe('Easy');
  });

  it('buckets blooms 3-4 as Medium', () => {
    expect(deriveDifficultyTier(3)).toBe('Medium');
    expect(deriveDifficultyTier(4)).toBe('Medium');
  });

  it('buckets blooms 5-6 as Hard', () => {
    expect(deriveDifficultyTier(5)).toBe('Hard');
    expect(deriveDifficultyTier(6)).toBe('Hard');
  });

  it('defaults a null blooms level to Medium rather than skewing the breakdown', () => {
    expect(deriveDifficultyTier(null)).toBe('Medium');
  });
});
