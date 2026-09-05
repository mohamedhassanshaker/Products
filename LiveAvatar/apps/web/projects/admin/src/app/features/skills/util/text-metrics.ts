/**
 * UTF-8 byte length of a string — the exact same one-line function as
 * `features/agent-builder/services/byte-length.util.ts`'s `utf8ByteLength`
 * (spec FR-CONFIG-2 / this phase's `SkillVersionContentFields.instructions`
 * 32768-**byte** cap, not characters). Duplicated locally rather than
 * imported: the admin SPA's ESLint feature-isolation zones
 * (`eslint.config.mjs` `webFeatures`) forbid the `skills` feature from
 * reaching into `agent-builder`'s folder, exactly the same boundary
 * `ToolsStore`'s own doc comment documents deliberately not crossing for
 * `AgentBuilderStore` — "mirrors that pattern rather than importing the
 * instance."
 * @param value - Candidate text
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Rough token estimate — "~4 UTF-8 bytes per token, ceil" — kept numerically
 * identical to the two other places this codebase already uses this same
 * heuristic: `features/tools/pages/tools-page/tools-page.component.ts`'s
 * client-side `attachedTokenEstimate`, and the backend's real V-11 estimator
 * (`apps/api/src/modules/deployment-config/domain/prompt-cost.ts`'s
 * `estimateTokens`). Used here for the Skill editor's live description
 * counter (`docs/v2/AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md`
 * §A5.5: "12 tokens. This is the ONLY text in the base prompt — the model
 * uses it to decide when to load this skill.").
 * @param text - Arbitrary text
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(utf8ByteLength(text) / 4);
}
