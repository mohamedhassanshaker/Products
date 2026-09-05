import { Type as T, type Static } from '@sinclair/typebox';

/**
 * `dynamics` top-level block (Phase 16, BL-062 — `docs/v2/BACKLOG.md`;
 * `docs/v2/UX_SCOPE.md`'s "Dynamics: plain new form (barge-in, endpointing,
 * verbosity, no-input, call limits) — net-new fields with no A3-A8
 * dependency"). Confirmed before writing this schema: **none of these five
 * concepts exist anywhere in this codebase today** — no schema field, no
 * runtime behavior. Endpoint detection today is a hardcoded LiveKit-VAD
 * default with zero admin control; there is no caller-interrupt/barge-in
 * handling at all in `apps/agent`.
 *
 * **This phase ships the config surface only — schema, validation, and the
 * Dynamics tab UI — not the runtime wiring.** Neither `BACKLOG.md`'s BL-062
 * row nor `UX_SCOPE.md`'s scope-decision text commits to wiring these
 * fields into `apps/agent`'s STT/turn-taking logic; both describe only the
 * form/schema ("follows the same field-pattern as the Tools attach form").
 * This mirrors a pattern this codebase has used before for a schema-ahead-
 * of-runtime field (e.g. `ChunkingStrategy.semantic`/`heading_aware` and
 * `RerankStageSchema`'s fixed-disabled literal, both "recognized, visibly
 * present, not yet invoked") — carried through unread by
 * `GetRuntimeConfigUseCase`/the Python agent until a future phase wires
 * real behavior. Flagged as a named follow-up in the plan doc, not a
 * silent gap.
 *
 * `dynamics` is **optional** at the top level (every other
 * `AgentConfigSchema` block is required) — a deliberate exception: unlike
 * transport/stt/tts/avatar/reasoning (load-bearing) or privacy/alerts
 * (compliance-critical), tuning barge-in sensitivity or a no-input
 * reprompt count is a genuine refinement an agent works correctly without.
 * Making it optional also avoids editing every one of this repo's ~20
 * existing fixture YAMLs the way Phase 13's `skills[]` addition (a
 * *required* field) had to — see the plan doc's Phase 16 "Decisions made
 * this phase" for the full rationale.
 */
export const BargeInSchema = T.Object({
  enabled: T.Boolean({ default: true }),
  sensitivity: T.Union([T.Literal('low'), T.Literal('medium'), T.Literal('high')], { default: 'medium' }),
});
export type BargeIn = Static<typeof BargeInSchema>;

/** R-x (no rule id assigned in the source spec — a plain new field, see this file's top docstring). */
export const NoInputSchema = T.Object({
  timeout_ms: T.Integer({ minimum: 1000, maximum: 60000, default: 8000 }),
  max_reprompts: T.Integer({ minimum: 0, maximum: 5, default: 2 }),
});
export type NoInput = Static<typeof NoInputSchema>;

/**
 * Matches the one concrete value the source wireframe shows ("Max turn
 * 200 tok / 20 s", `AgentBuilder_..._HITL.md` §A9.2) — a per-turn cap, not
 * a whole-call duration cap (that already exists, unrelated, as
 * `Session.maxDurationSeconds`).
 */
export const CallLimitsSchema = T.Object({
  max_turn_tokens: T.Integer({ minimum: 1, maximum: 8000, default: 200 }),
  max_turn_seconds: T.Integer({ minimum: 1, maximum: 120, default: 20 }),
});
export type CallLimits = Static<typeof CallLimitsSchema>;

export const VerbositySchema = T.Union([T.Literal('concise'), T.Literal('balanced'), T.Literal('detailed')]);
export type Verbosity = Static<typeof VerbositySchema>;

export const DynamicsSchema = T.Object({
  barge_in: BargeInSchema,
  /** The one concrete field path the source spec names directly: `dynamics.endpointing_silence_ms` (§A4.1's turn-budget diagram). */
  endpointing_silence_ms: T.Integer({ minimum: 100, maximum: 5000, default: 700 }),
  verbosity: T.Union([T.Literal('concise'), T.Literal('balanced'), T.Literal('detailed')], { default: 'balanced' as const }),
  no_input: NoInputSchema,
  call_limits: CallLimitsSchema,
});
export type Dynamics = Static<typeof DynamicsSchema>;
