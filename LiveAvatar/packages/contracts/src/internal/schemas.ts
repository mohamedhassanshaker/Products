import { Type as T, type Static } from '@sinclair/typebox';
import '../agent-config/formats';
import { AgentConfigSchema } from '../agent-config/schema';
import { HitlDecisionSchema, HitlProposedActionSchema } from '../hitl/schemas';

/**
 * Wire contracts for the agent-facing `/internal` routes (LLD §5.9),
 * guarded by `X-Internal-Token` (`InternalTokenGuard`). Mirrored on the
 * Python side by `apps/agent/src/avatar_agent/contracts/internal_api.py`
 * and `contracts/runtime_config.py` — these are not part of the
 * fixture-corpus cross-language contract test (that test is specifically
 * about `AgentConfigSchema`, ADR-001 §7); they are still kept field-for-
 * field aligned by convention/code review since both sides read/write the
 * same JSON over the wire.
 */

/**
 * One resolved `ToolDefinition` row (LLD §4.3), enriched onto the runtime
 * config for every `agent.tools[]` entry the tenant marked `enabled`.
 *
 * QA fix (phase4-agent-python D-2): `agent.tools[]` itself (from
 * `AgentConfigSchema`) only ever carries `{name, api_ref, enabled}` — a
 * *reference*, never enough for the agent to actually call the tool (no
 * `url`/`method`/credential). Without this array the Python agent had no
 * way to resolve `api_ref` into a callable HTTP tool at all, which is the
 * reason `entrypoint.build_pipeline` hardcoded `tools=[]`/`tool_specs=[]`
 * unconditionally. This is purely additive to the wire contract — every
 * field here is new, nothing existing changes shape — so it doesn't touch
 * `AgentConfigSchema` or the fixture-corpus cross-language contract test
 * (ADR-001 §7), which is scoped to `AgentConfigSchema` alone.
 */
export const ToolDefinitionDtoSchema = T.Object({
  api_ref: T.String({ minLength: 1, maxLength: 64 }),
  name: T.String({ minLength: 1, maxLength: 80 }),
  description: T.Optional(T.String()),
  method: T.String({ minLength: 1, maxLength: 16 }),
  url: T.String({ format: 'uri' }),
  credential_ref: T.Optional(T.String({ minLength: 1, maxLength: 256 })),
  args_schema: T.Record(T.String(), T.Unknown()),
});
export type ToolDefinitionDto = Static<typeof ToolDefinitionDtoSchema>;

/**
 * Phase 13 (BL-049/050/051) — the ~15-token, description-only blurb R-S1's
 * progressive disclosure allows into the base prompt. Enrichment of
 * `skills[]`'s bare `{id, version}` refs, the same relationship
 * `tool_definitions` above has to `agent.tools[]`. Deliberately **not**
 * named `skills` (which would require overriding `AgentConfigSchema.skills`'s
 * own `SkillRef[]` type via `T.Intersect`/a Pydantic subclass field
 * override — the Python side would then fail mypy's override-compatibility
 * check for a same-named field with an incompatible type) — see the plan
 * doc's Phase 13 "Decisions made this phase" for the full rationale.
 * `version` here is always a concrete resolved number (never the literal
 * `"latest"`) — resolved once, at session-start read time, by
 * `GetRuntimeConfigUseCase`.
 */
export const SkillSummaryDtoSchema = T.Object({
  id: T.String({ minLength: 1, maxLength: 64 }),
  version: T.Integer({ minimum: 1 }),
  name: T.String({ minLength: 1, maxLength: 80 }),
  description: T.String({ minLength: 1, maxLength: 500 }),
});
export type SkillSummaryDto = Static<typeof SkillSummaryDtoSchema>;

/** `GET /internal/sessions/{id}/runtime-config` response (LLD §6.3). */
export const AgentRuntimeConfigDtoSchema = T.Intersect([
  AgentConfigSchema,
  T.Object({
    session_id: T.String({ format: 'uuid' }),
    room_name: T.String(),
    endpoints: T.Record(T.String(), T.String({ format: 'uri' })),
    // Only the tenant's *enabled* tools whose `api_ref` resolved against a
    // real `ToolDefinition` row — an `agent.tools[]` entry referencing a
    // since-deleted/disabled definition is silently omitted here rather
    // than failing the whole runtime-config fetch (LLD §5.5.2's
    // `CONFIG_TOOL_UNKNOWN` already prevents publishing such a config in
    // the first place; this is defense in depth, not the primary gate).
    tool_definitions: T.Array(ToolDefinitionDtoSchema, { default: [] }),
    // Phase 13 (BL-049/050/051) — resolved skill description blurbs (see
    // `SkillSummaryDtoSchema`'s doc comment for why this isn't named `skills`).
    skill_summaries: T.Array(SkillSummaryDtoSchema, { default: [] }),
  }),
]);
export type AgentRuntimeConfigDto = Static<typeof AgentRuntimeConfigDtoSchema>;

/** `POST /internal/sessions/{id}/events` (LLD §8.1's transition table). */
export const SessionEventRequestSchema = T.Object({
  type: T.Union([
    T.Literal('joined'),
    T.Literal('active'),
    T.Literal('degraded'),
    T.Literal('failed'),
    T.Literal('ended'),
  ]),
  error_code: T.Optional(T.String({ maxLength: 64 })),
  at: T.String({ format: 'date-time' }),
});
export type SessionEventRequest = Static<typeof SessionEventRequestSchema>;

/** One `TranscriptUtterance` row (FR-CALL-3/FR-SESS-1). */
export const UtteranceItemSchema = T.Object({
  seq: T.Integer({ minimum: 0 }),
  role: T.Union([T.Literal('user'), T.Literal('assistant')]),
  text: T.Optional(T.String()),
  started_at: T.String({ format: 'date-time' }),
  ended_at: T.Optional(T.String({ format: 'date-time' })),
});
export type UtteranceItem = Static<typeof UtteranceItemSchema>;

/** `POST /internal/sessions/{id}/utterances` — batch upsert. */
export const UtteranceBatchRequestSchema = T.Object({
  items: T.Array(UtteranceItemSchema),
});
export type UtteranceBatchRequest = Static<typeof UtteranceBatchRequestSchema>;

/**
 * One `LatencyHop` row (NFR-1). Phase 9 (BL-039) adds the `node` hop kind
 * (one row per graph-node execution, node-level session trace) and its
 * `node_id`/`node_type`/`lane` fields.
 */
export const HopItemSchema = T.Object({
  utterance_seq: T.Integer({ minimum: 0 }),
  hop: T.Union([
    T.Literal('stt'),
    T.Literal('llm'),
    T.Literal('tts'),
    T.Literal('avatar'),
    T.Literal('e2e'),
    T.Literal('node'),
  ]),
  first_partial_ms: T.Optional(T.Integer({ minimum: 0 })),
  first_token_ms: T.Optional(T.Integer({ minimum: 0 })),
  first_audio_ms: T.Optional(T.Integer({ minimum: 0 })),
  first_frame_ms: T.Optional(T.Integer({ minimum: 0 })),
  total_ms: T.Optional(T.Integer({ minimum: 0 })),
  provider_key: T.Optional(T.String({ maxLength: 64 })),
  used_fallback: T.Optional(T.Boolean({ default: false })),
  error_code: T.Optional(T.String({ maxLength: 64 })),
  node_id: T.Optional(T.String({ maxLength: 64 })),
  node_type: T.Optional(T.String({ maxLength: 32 })),
  lane: T.Optional(T.Union([T.Literal('foreground'), T.Literal('background')])),
});
export type HopItem = Static<typeof HopItemSchema>;

/** `POST /internal/sessions/{id}/hops` — batch upsert. */
export const HopBatchRequestSchema = T.Object({
  items: T.Array(HopItemSchema),
});
export type HopBatchRequest = Static<typeof HopBatchRequestSchema>;

/** `POST /internal/sessions/{id}/summary` — the agent is the only writer (HLD §7.3). */
export const SummaryRequestSchema = T.Object({
  summary_status: T.Union([T.Literal('ready'), T.Literal('unavailable')]),
  summary_text: T.Optional(T.String({ maxLength: 500 })),
});
export type SummaryRequest = Static<typeof SummaryRequestSchema>;

/** `POST /internal/gpu-heartbeats` (FR-GPU-3). */
export const GpuHeartbeatRequestSchema = T.Object({
  hostname: T.String({ minLength: 1, maxLength: 128 }),
  role: T.Union([T.Literal('stt'), T.Literal('tts'), T.Literal('avatar')]),
  gpu_util_pct: T.Number({ minimum: 0, maximum: 100 }),
  mem_util_pct: T.Number({ minimum: 0, maximum: 100 }),
  healthy: T.Boolean(),
  tenant_id: T.Optional(T.String({ format: 'uuid' })),
  reported_at: T.String({ format: 'date-time' }),
});
export type GpuHeartbeatRequest = Static<typeof GpuHeartbeatRequestSchema>;

/**
 * Phase 12b (BL-045/047) — `POST /internal/knowledge/search`: hybrid search
 * (pgvector cosine + Postgres FTS `ts_rank`, blended) plus an optional
 * metadata-filter pass, called by the agent's Retrieve node executor and by
 * `ai_service`'s `/retrieve-preview` (the Playground's real code path) —
 * neither Python process ever touches Postgres directly (ADR-001); this is
 * the one seam that does, on their behalf. `field`/`op`/`value` are the most
 * user-shaped input reaching this raw-SQL surface — `field` is
 * pattern-constrained here **and** re-checked defensively at the query-
 * building call site before being interpolated as a JSON path key (a
 * JSONB key cannot itself be a bound parameter); `value` is always bound.
 */
export const KnowledgeSearchFilterConditionSchema = T.Object({
  field: T.String({ minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_]+$' }),
  op: T.Union([T.Literal('eq'), T.Literal('neq'), T.Literal('contains')]),
  value: T.String({ minLength: 1, maxLength: 500 }),
});
export type KnowledgeSearchFilterCondition = Static<typeof KnowledgeSearchFilterConditionSchema>;

export const KnowledgeSearchRequestSchema = T.Object({
  tenant_id: T.String({ format: 'uuid' }),
  source_refs: T.Array(T.String({ format: 'uuid' }), { minItems: 1 }),
  query_text: T.String({ minLength: 1, maxLength: 2000 }),
  query_embedding: T.Array(T.Number(), { minItems: 1, maxItems: 4096 }),
  vector_weight: T.Number({ minimum: 0, maximum: 1 }),
  keyword_weight: T.Number({ minimum: 0, maximum: 1 }),
  candidates: T.Integer({ minimum: 1, maximum: 100 }),
  filter: T.Optional(KnowledgeSearchFilterConditionSchema),
});
export type KnowledgeSearchRequest = Static<typeof KnowledgeSearchRequestSchema>;

export const KnowledgeSearchCandidateSchema = T.Object({
  chunk_id: T.String({ format: 'uuid' }),
  source_id: T.String({ format: 'uuid' }),
  source_name: T.String(),
  text: T.String(),
  vector_score: T.Number(),
  keyword_score: T.Number(),
  blend_score: T.Number(),
  /** `true` when no filter is configured/enabled, or the chunk's metadata matches it. */
  passed_filter: T.Boolean(),
});
export type KnowledgeSearchCandidate = Static<typeof KnowledgeSearchCandidateSchema>;

export const KnowledgeSearchResponseSchema = T.Object({
  candidates: T.Array(KnowledgeSearchCandidateSchema),
});
export type KnowledgeSearchResponse = Static<typeof KnowledgeSearchResponseSchema>;

/** `POST /internal/knowledge/gaps` (Phase 12b, R-R7) — a below-threshold retrieval event, called only by the live Retrieve node executor, never the Playground preview (see the plan doc's "Decisions made this phase" #9). */
export const KnowledgeGapRequestSchema = T.Object({
  tenant_id: T.String({ format: 'uuid' }),
  source_id: T.Optional(T.String({ format: 'uuid' })),
  query: T.String({ minLength: 1, maxLength: 1000 }),
  best_score: T.Optional(T.Number()),
});
export type KnowledgeGapRequest = Static<typeof KnowledgeGapRequestSchema>;

/**
 * `GET /internal/skills/{id}/versions/{version}/body` (Phase 13,
 * BL-049/050/051; `ARCHITECTURE_NOTES.md` §5.3) — the lazily-fetched full
 * skill body, called only once a `skill`-type graph node's trigger fires
 * (never eagerly for every attached skill — that's the entire point of
 * progressive disclosure). `tool_definitions` mirrors
 * `ToolDefinitionDtoSchema` exactly (same enrichment shape
 * `AgentRuntimeConfigDtoSchema.tool_definitions` already uses for
 * `agent.tools[]`) since a skill's own tools may not be part of the
 * agent's "always available" list at all.
 */
export const SkillBodyResponseSchema = T.Object({
  id: T.String({ format: 'uuid' }),
  version: T.Integer({ minimum: 1 }),
  name: T.String(),
  description: T.String(),
  instructions: T.String(),
  trigger_mode: T.Union([T.Literal('model'), T.Literal('router')]),
  tool_definitions: T.Array(ToolDefinitionDtoSchema, { default: [] }),
  knowledge_filters: T.Object({
    source_refs: T.Array(T.String()),
    top_k: T.Optional(T.Integer()),
    min_score: T.Optional(T.Number()),
  }),
  budget_ms: T.Integer(),
});
export type SkillBodyResponse = Static<typeof SkillBodyResponseSchema>;

/**
 * `POST /internal/hitl-decisions` (Phase 14, BL-052/053;
 * `ARCHITECTURE_NOTES.md` §6.2 point 1/3) — the agent's entry point on
 * hitting a HITL node: creates the `pending` `HitlDecision` row it then
 * short-polls via `GET /internal/hitl-decisions/{id}` below.
 */
/**
 * `GET /internal/tenants/{id}/subagent-persona` (Phase 15, BL-058;
 * ARCHITECTURE_NOTES.md §3.2) - the delegated persona a `subagent`-type
 * node's target tenant exposes. v1 delegation is one bounded LLM turn
 * against this persona (never a nested graph/interpreter - see
 * `SubAgentNodeSchema`'s doc comment), so only what a single LLM turn
 * needs travels here: the target's own `system_prompt` and its enabled
 * tool definitions (mirrors `AgentRuntimeConfigDtoSchema.tool_definitions`'s
 * own enrichment shape exactly). Only ever resolvable for a **published**
 * target config - an unpublished/missing target is a 404, not a partial
 * response (mirrors `GetRuntimeConfigUseCase`'s own `CONFIG_INCOMPLETE`
 * treatment of the same condition on the caller's own tenant).
 */
export const SubAgentPersonaResponseSchema = T.Object({
  tenant_id: T.String({ format: 'uuid' }),
  system_prompt: T.String(),
  tool_definitions: T.Array(ToolDefinitionDtoSchema, { default: [] }),
});
export type SubAgentPersonaResponse = Static<typeof SubAgentPersonaResponseSchema>;

export const CreateHitlDecisionRequestSchema = T.Object({
  tenant_id: T.String({ format: 'uuid' }),
  session_id: T.String({ format: 'uuid' }),
  gate_id: T.String({ minLength: 1, maxLength: 64 }),
  utterance_seq: T.Integer({ minimum: 0 }),
  proposed_action: HitlProposedActionSchema,
});
export type CreateHitlDecisionRequest = Static<typeof CreateHitlDecisionRequestSchema>;

/** Resolved once, server-side, from the referenced `HitlGate` — what the interpreter needs to speak the hold treatment and track its own SLA deadline. */
export const CreateHitlDecisionResponseSchema = T.Object({
  id: T.String({ format: 'uuid' }),
  hold_treatment_text: T.String(),
  sla_seconds: T.Integer(),
});
export type CreateHitlDecisionResponse = Static<typeof CreateHitlDecisionResponseSchema>;

/** `GET /internal/hitl-decisions/{id}` — the agent's short-poll target. Same shape as the admin-facing `HitlDecisionSchema` (`hitl/schemas.ts`) — one representation, two audiences. */
export const InternalHitlDecisionResponseSchema = HitlDecisionSchema;
export type InternalHitlDecisionResponse = Static<typeof InternalHitlDecisionResponseSchema>;

/** `POST /internal/alerts`. */
export const AlertRequestSchema = T.Object({
  tenant_id: T.String({ format: 'uuid' }),
  type: T.Union([
    T.Literal('llm_failover'),
    T.Literal('provider_unreachable'),
    T.Literal('session_failed'),
    T.Literal('gpu_unhealthy'),
    // Phase 15 (BL-059) — a `handoff`-type graph node fired.
    T.Literal('handoff_requested'),
  ]),
  message: T.String({ minLength: 1, maxLength: 500 }),
});
export type AlertRequest = Static<typeof AlertRequestSchema>;
