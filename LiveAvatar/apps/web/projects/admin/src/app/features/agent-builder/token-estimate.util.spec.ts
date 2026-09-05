import { estimateTokens } from './token-estimate.util';

describe('estimateTokens', () => {
  it('estimates roughly one token per 4 characters', () => {
    expect(estimateTokens('a'.repeat(40))).toBe(10);
  });

  it('rounds up a partial token', () => {
    expect(estimateTokens('abc')).toBe(1);
  });

  it('returns 0 for an empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });
});
