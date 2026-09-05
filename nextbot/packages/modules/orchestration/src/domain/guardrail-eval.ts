/**
 * `GUARDRAIL` — LLD §6.2 step 3: evaluated against `guardrail_rule where applies_at =
 * PreToolCall`, **before any `tool_call` row is created**. Full guardrail authoring
 * (rule CRUD, the PII masking context matrix) is BL-10/Phase 17; this phase ships
 * only the stub rule set (an in-memory array, no table yet) but the **evaluation
 * point itself is real and structurally load-bearing** — FR-AI-10 requires it to
 * exist now, not be silently deferred alongside the authoring UI. A pure function,
 * exactly like `resolvePermission` (LLD §6), so it is exhaustively unit-testable
 * without a database.
 */

export type GuardrailDecision =
  | { effect: "Allow" }
  | { effect: "BlockToolCall"; reason: string }
  | { effect: "EscalateToHuman"; reason: string };

export interface GuardrailEvalContext {
  toolName: string;
  args: Record<string, unknown>;
  recognizedTask?: string;
}

/** A stub rule shape — deliberately minimal (name match + a fixed effect), enough to
 * prove the pre-call short-circuit exists without building the full condition
 * language BL-10's authoring UI will add. */
export interface StubGuardrailRule {
  id: string;
  /** Blocks/escalates only when the proposed tool name matches exactly — the
   * simplest possible non-trivial condition, standing in for the real
   * `guardrail_rule.conditions` expression language. */
  toolName: string;
  effect: "BlockToolCall" | "EscalateToHuman";
  reason: string;
}

/**
 * Evaluates the stub `PreToolCall` guardrail rule set against one proposed tool
 * call. No rules configured (this phase's default, and every tenant until BL-10
 * ships authoring) => `Allow`. First matching rule wins, evaluated in array order
 * (mirrors `resolvePermission`'s deterministic first-match-wins convention).
 */
export function evaluateGuardrails(rules: StubGuardrailRule[], ctx: GuardrailEvalContext): GuardrailDecision {
  const matched = rules.find((r) => r.toolName === ctx.toolName);
  if (!matched) return { effect: "Allow" };
  if (matched.effect === "BlockToolCall") return { effect: "BlockToolCall", reason: matched.reason };
  return { effect: "EscalateToHuman", reason: matched.reason };
}
