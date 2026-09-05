import { estimateTokens, utf8ByteLength } from './text-metrics';

/**
 * Numeric-consistency check (not just "does it run"): asserts the exact same
 * outputs the two other "~4 UTF-8 bytes/token, ceil" call sites in this
 * codebase would produce for the same inputs —
 * `features/tools/pages/tools-page/tools-page.component.ts`'s
 * `attachedTokenEstimate` (client) and
 * `apps/api/.../deployment-config/domain/prompt-cost.ts`'s `estimateTokens`
 * (server). Both reduce to `Math.ceil(byteLength / 4)`, reimplemented here
 * inline (not imported — that would defeat the point of a consistency
 * check) as the independent oracle.
 */
function referenceEstimate(text: string): number {
  return Math.ceil(new TextEncoder().encode(text).length / 4);
}

describe('utf8ByteLength', () => {
  it('counts ASCII 1 byte per character', () => {
    expect(utf8ByteLength('hello')).toBe(5);
  });

  it('counts multi-byte UTF-8 characters correctly (undercounted by .length)', () => {
    // '€' is 1 UTF-16 code unit but 3 UTF-8 bytes.
    expect(utf8ByteLength('€')).toBe(3);
    expect('€'.length).toBe(1);
  });

  it('returns 0 for an empty string', () => {
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('estimateTokens', () => {
  const samples = [
    '',
    'refunds',
    'Handle refund requests, eligibility checks and processing',
    'You are handling a refund request. Follow this order:\n1. Confirm the order reference before anything else.',
    '日本語のテキストをテストする', // multi-byte sample
  ];

  it.each(samples)('matches the Tools tab / backend "~4 bytes/token, ceil" heuristic exactly for %j', (text) => {
    expect(estimateTokens(text)).toBe(referenceEstimate(text));
  });

  it('ceils rather than floors/rounds', () => {
    // 5 bytes / 4 = 1.25 -> ceil to 2.
    expect(estimateTokens('abcde')).toBe(2);
  });

  it('returns 0 for empty text without dividing', () => {
    expect(estimateTokens('')).toBe(0);
  });
});
