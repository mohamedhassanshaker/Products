/**
 * FR-PDF-12/NFR-7's per-session budget check — a pure function so the "budget check runs BEFORE each
 * batch/page call, not after" ordering requirement (this sub-slice's own exit gate) can be asserted
 * independently of any I/O. Ported verbatim from
 * `legacy/api/src/modules/pdf-processing/domain/budget.ts` — this sub-slice's `ExamExtractionService`
 * is its only consumer; a later sub-slice's lesson-generation loop reuses this same function without
 * duplicating the comparison logic.
 */

/** The subset of a session's running totals the budget check needs. */
export interface BudgetUsage {
  tokensUsed: number;
  totalCost: number;
}

/** The two enforced ceilings, read from `env.schema.ts` (`PDF_MAX_TOKENS_PER_SESSION`/
 * `PDF_MAX_COST_PER_SESSION_USD`). */
export interface BudgetLimits {
  maxTokensPerSession: number;
  maxCostPerSessionUsd: number;
}

/**
 * `true` once a session's running usage has reached (not merely exceeded) either ceiling. Called
 * immediately before every batch/page AI call — never after — so a session that has already spent its
 * budget never issues one more billable call "to see how close it is" (FR-PDF-12: "a session that
 * would exceed its budget completes gracefully... rather than failing outright").
 */
export function isBudgetExhausted(usage: BudgetUsage, limits: BudgetLimits): boolean {
  return usage.tokensUsed >= limits.maxTokensPerSession || usage.totalCost >= limits.maxCostPerSessionUsd;
}
