/**
 * Rough "~4 bytes per token" heuristic — the same order-of-magnitude
 * estimate `ToolsPageComponent`'s `attachedTokenEstimate` and
 * `features/skills/util/text-metrics.ts`'s `estimateTokens` already use
 * client-side (each feature-local, per this codebase's established
 * duplicate-across-feature-boundaries convention — see
 * `reasoning.store.ts`'s debounce-bug comment for another example of the
 * same pattern). Used by both `OverviewTabComponent` and
 * `BuilderShellComponent` — extracted here, not duplicated, because both
 * live in this one feature, where there's no ESLint isolation reason to
 * keep two copies. The authoritative number is the server's
 * `computeBasePromptCost` (`apps/api/.../domain/prompt-cost.ts`), surfaced
 * to the client only as `CONFIG_BASE_PROMPT_COST_HIGH`'s warning *text*,
 * not a structured field — see `overview-tab.component.ts`'s doc comment.
 * @param text - Candidate text to estimate a token count for
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
