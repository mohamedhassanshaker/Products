import { computeBasePromptCost, DEFAULT_BASE_PROMPT_TOKEN_CEILING, estimateTokens } from './prompt-cost';

describe('estimateTokens', () => {
  it('returns 0 for empty/falsy text', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimates ~4 UTF-8 bytes per token (ceil), matching the Tools tab client-side heuristic', () => {
    expect(estimateTokens('a'.repeat(8))).toBe(2);
    expect(estimateTokens('a'.repeat(9))).toBe(3);
  });

  it('counts UTF-8 bytes, not UTF-16 code units, for multi-byte characters', () => {
    // "é" is 2 bytes in UTF-8 but 1 UTF-16 code unit — this is the exact
    // under-counting bug class `CONFIG_PROMPT_TOO_LARGE`'s own byte
    // re-check exists to avoid; the estimator here should agree.
    expect(estimateTokens('é')).toBe(1); // ceil(2/4) = 1
    expect(estimateTokens('éééé')).toBe(2); // ceil(8/4) = 2
  });
});

describe('computeBasePromptCost', () => {
  it('sums core + tools + skills terms', () => {
    const breakdown = computeBasePromptCost(
      'a'.repeat(40), // 10 tokens
      [{ name: 'a'.repeat(20), description: null }], // 5 tokens
      [{ name: 'a'.repeat(20), description: 'a'.repeat(20) }], // 10 tokens
    );
    expect(breakdown.core_tokens).toBe(10);
    expect(breakdown.tools_tokens).toBe(5);
    expect(breakdown.skills_tokens).toBe(10);
    expect(breakdown.total_tokens).toBe(25);
  });

  it('is not over the ceiling by default when well under DEFAULT_BASE_PROMPT_TOKEN_CEILING', () => {
    const breakdown = computeBasePromptCost('hi', [], []);
    expect(breakdown.ceiling_tokens).toBe(DEFAULT_BASE_PROMPT_TOKEN_CEILING);
    expect(breakdown.over_ceiling).toBe(false);
  });

  it('flags over_ceiling once the total exceeds a custom ceiling', () => {
    const breakdown = computeBasePromptCost('a'.repeat(40), [], [], 5);
    expect(breakdown.over_ceiling).toBe(true);
  });

  it('handles an absent system_prompt without throwing', () => {
    expect(() => computeBasePromptCost(undefined, [], [])).not.toThrow();
  });

  describe('Phase 16 (BL-063) — tool args_schema contributes to the tools term', () => {
    it('counts a tool with a non-empty args_schema as more expensive than the same tool with none', () => {
      const withoutSchema = computeBasePromptCost('', [{ name: 'weather', description: 'Get weather' }], []);
      const withSchema = computeBasePromptCost(
        '',
        [{ name: 'weather', description: 'Get weather', argsSchema: { type: 'object', properties: { city: { type: 'string' } } } }],
        [],
      );
      expect(withSchema.tools_tokens).toBeGreaterThan(withoutSchema.tools_tokens);
    });

    it('an empty args_schema object contributes nothing extra', () => {
      const withEmptySchema = computeBasePromptCost('', [{ name: 'weather', description: 'Get weather', argsSchema: {} }], []);
      const withoutSchema = computeBasePromptCost('', [{ name: 'weather', description: 'Get weather' }], []);
      expect(withEmptySchema.tools_tokens).toBe(withoutSchema.tools_tokens);
    });

    it('never applies to skills (skills carry no args_schema field at all)', () => {
      const breakdown = computeBasePromptCost('', [], [{ name: 'refunds', description: 'Handle refunds' }]);
      // No compile-time way to pass argsSchema to a skill entry at all — this
      // test documents that guarantee rather than exercising a code branch.
      expect(breakdown.skills_tokens).toBeGreaterThan(0);
    });
  });
});
