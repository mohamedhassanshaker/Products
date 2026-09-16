/**
 * The save-time contrast gate (design-system.md §10.2, §9.2 rule 2; ADR-0007). Every
 * point in this module where a colour token set would be applied to a tenant calls
 * this first — the block, not a warning, for text pairs.
 *
 * Calls the real `checkContrast` from `@shj3/tokens` — the same implementation the
 * package's own shipped-skin regression suite (§12.4) and the Appearance module's
 * future save path both run against, so the runtime gate and the tests cannot drift
 * apart (`contrast.ts`'s own module comment states this explicitly).
 */

import { checkContrast, type ContrastReport, type SemanticColorTokens } from "@shj3/tokens";

export class ContrastBlockedError extends Error {
  constructor(readonly report: ContrastReport) {
    const summary = report.blockers
      .map((b) => `${b.pair.fg}/${b.pair.bg} (${b.ratio.toFixed(2)}:1, needs ${b.required}:1)`)
      .join(", ");
    super(`Save refused: ${report.blockers.length} text pair(s) fail WCAG 2.1 AA — ${summary}`);
    this.name = "ContrastBlockedError";
  }
}

/**
 * Throws `ContrastBlockedError` if any TEXT pair fails AA. Non-text failures (the
 * warning class) do not block — `checkContrast`'s own `passed` flag already encodes
 * exactly that distinction (`isBlocking`), so this function adds no new policy, only
 * the "refuse to proceed" behaviour §9.2 rule 2 requires.
 */
export function assertContrastPasses(tokens: SemanticColorTokens): ContrastReport {
  const report = checkContrast(tokens);
  if (!report.passed) {
    throw new ContrastBlockedError(report);
  }
  return report;
}
