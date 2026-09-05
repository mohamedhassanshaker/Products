import { describe, expect, it } from 'vitest';
import { isBudgetExhausted } from './budget';

const LIMITS = { maxTokensPerSession: 1000, maxCostPerSessionUsd: 2 };

describe('isBudgetExhausted', () => {
  it('is false when both usage figures are well under their ceilings', () => {
    expect(isBudgetExhausted({ tokensUsed: 100, totalCost: 0.5 }, LIMITS)).toBe(false);
  });

  it('is true once tokensUsed reaches (not just exceeds) the token ceiling', () => {
    expect(isBudgetExhausted({ tokensUsed: 1000, totalCost: 0 }, LIMITS)).toBe(true);
  });

  it('is true once totalCost reaches (not just exceeds) the cost ceiling', () => {
    expect(isBudgetExhausted({ tokensUsed: 0, totalCost: 2 }, LIMITS)).toBe(true);
  });

  it('is true when tokensUsed exceeds the ceiling', () => {
    expect(isBudgetExhausted({ tokensUsed: 1500, totalCost: 0 }, LIMITS)).toBe(true);
  });

  it('is true when either ceiling is exhausted even if the other has plenty of headroom', () => {
    expect(isBudgetExhausted({ tokensUsed: 5, totalCost: 999 }, LIMITS)).toBe(true);
  });
});
