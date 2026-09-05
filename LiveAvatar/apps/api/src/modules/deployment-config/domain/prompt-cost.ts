/**
 * V-11 (Phase 13, BL-049/050/051; `ARCHITECTURE_NOTES.md` §7 — "base
 * prompt+skills+tools <= ceiling, Gate A structural, warning-class").
 *
 * Despite the table's "Gate A structural" label, this file is a **pure**
 * estimator with no I/O of its own — the two terms it sums (attached tool
 * descriptions, attached skill descriptions) both need a resolved
 * `ToolDefinition`/`SkillVersion` row's `description` text, which only a
 * Gate-B-style DB read can provide (`agent.tools[]`/`skills[]` themselves
 * only ever carry a bare `{name/id, ...}` reference, never the
 * description). The rule that *calls* this pure function
 * (`basePromptCostWithinCeilingRule` in `combination-rules.ts`) therefore
 * lives in Gate B, where the tool/skill catalogs are already loaded once
 * per validate/save call — same split every other "structural function,
 * DB-aware caller" pairing in this codebase already follows (e.g.
 * `computeCriticalPath` is pure; `criticalPathWithinBudgetRule` is the
 * Gate-B-adjacent caller).
 *
 * **Phase 8 never actually built a backend V-11 estimator** — only a
 * client-side heuristic banner on the Tools tab
 * (`tools-page.component.ts`'s `attachedTokenEstimate`, "~4 UTF-8
 * bytes/token"). This file is the first real backend V-11 estimator,
 * built once with both terms (tools + skills) rather than "completing" a
 * pre-existing sum, per this phase's own task brief.
 *
 * **Phase 16 (BL-063, "final V-11 sum") addition**: the rule's own text
 * says "always-on tool schemas," not "tool descriptions" — this file
 * previously summed only `name + description` for tools (matching the
 * doc comment below, now corrected). A tool's JSON `args_schema` is what
 * actually reaches the model in real function-calling and often costs
 * *more* tokens than its description, so it now contributes too — for
 * `agent.tools[]`'s always-on entries only, never a skill's own attached
 * tools (R-S1: only a skill's name+description ~15-token blurb ever
 * reaches the base prompt; its tools/instructions are lazy-loaded only
 * once triggered, never part of this sum).
 */

/** Same heuristic the Tools tab's client-side banner already uses (Phase 8) — kept numerically consistent across surfaces rather than inventing a second ratio. No real tokenizer is available server-side either. */
const BYTES_PER_TOKEN_ESTIMATE = 4;

/**
 * Default warning ceiling (tokens) for the whole base prompt (core
 * instructions + tool descriptions + skill descriptions). Matches UC-S1's
 * own narrative numbers ("system prompt has grown to 4,200 tokens ...
 * rising") as the order-of-magnitude where this should start flagging —
 * a code constant, not a per-tenant configurable field, since nothing in
 * this codebase's config schema has a slot for "prompt cost ceiling" and
 * inventing an admin-configurable setting is out of this phase's scope.
 */
export const DEFAULT_BASE_PROMPT_TOKEN_CEILING = 4000;

/** @param text - Arbitrary text @returns Estimated token count (ceil of UTF-8 byte length / 4) */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }
  return Math.ceil(Buffer.byteLength(text, 'utf8') / BYTES_PER_TOKEN_ESTIMATE);
}

/**
 * One attached tool or skill's contribution. `argsSchema` is set only for
 * an `agent.tools[]` entry (never a skill — see this file's top docstring)
 * and, when present, its JSON size contributes to the sum alongside
 * `name`/`description`.
 */
export interface AttachedItemDescription {
  name: string;
  description: string | null | undefined;
  argsSchema?: Record<string, unknown>;
}

/** Full breakdown returned to callers — enough for a `ConfigError.message` to cite exact numbers. */
export interface PromptCostBreakdown {
  core_tokens: number;
  tools_tokens: number;
  skills_tokens: number;
  total_tokens: number;
  ceiling_tokens: number;
  over_ceiling: boolean;
}

/**
 * Pure sum of the three V-11 terms.
 * @param systemPrompt - `agent.system_prompt` (core instructions)
 * @param attachedTools - Resolved `{name, description}` for every enabled `agent.tools[]` entry
 * @param attachedSkills - Resolved `{name, description}` for every `skills[]` entry
 * @param ceilingTokens - Override for tests; defaults to `DEFAULT_BASE_PROMPT_TOKEN_CEILING`
 */
export function computeBasePromptCost(
  systemPrompt: string | undefined,
  attachedTools: AttachedItemDescription[],
  attachedSkills: AttachedItemDescription[],
  ceilingTokens: number = DEFAULT_BASE_PROMPT_TOKEN_CEILING,
): PromptCostBreakdown {
  const core_tokens = estimateTokens(systemPrompt ?? '');
  const tools_tokens = attachedTools.reduce((sum, t) => {
    const schemaText = t.argsSchema && Object.keys(t.argsSchema).length > 0 ? JSON.stringify(t.argsSchema) : '';
    return sum + estimateTokens(t.name + (t.description ?? '') + schemaText);
  }, 0);
  const skills_tokens = attachedSkills.reduce((sum, s) => sum + estimateTokens(s.name + (s.description ?? '')), 0);
  const total_tokens = core_tokens + tools_tokens + skills_tokens;
  return {
    core_tokens,
    tools_tokens,
    skills_tokens,
    total_tokens,
    ceiling_tokens: ceilingTokens,
    over_ceiling: total_tokens > ceilingTokens,
  };
}
