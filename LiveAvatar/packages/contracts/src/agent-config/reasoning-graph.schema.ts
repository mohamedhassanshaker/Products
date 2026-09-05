import { Type as T, type Static } from '@sinclair/typebox';
import { LlmProviderKey } from './schema-keys';

/**
 * `reasoning.graph[]` — Phase 9 (BL-035, `docs/v2/BACKLOG.md`;
 * `docs/v2/ARCHITECTURE_NOTES.md` §1/§3). Replaces the flat `llm:` block
 * with a discriminated-union graph of node types. Phase 9 modeled the six
 * node types needed for that phase's exit condition — LLM, Tool, Retrieve
 * (stub), Router, Speak, End. Phase 11 (BL-042/043) adds Parallel and Loop.
 * Phase 13 adds Skill; Phase 14 adds HITL; Phase 15 adds Sub-agent/
 * Handoff/State, completing the full 13-type A3.2 set.
 *
 * Mirrored 1:1 in `apps/agent/src/avatar_agent/contracts/runtime_config.py`
 * as a Pydantic discriminated union (`Field(discriminator="type")`) —
 * enforced by `agent-config-cross-language.contract.spec.ts` /
 * `test_agent_config_contract.py`'s shared fixture corpus (ADR-001).
 *
 * **Branch/body representation (Phase 11 decision)**: `ParallelNode`'s
 * branches and `LoopNode`'s body are **single node-id references into this
 * same flat `graph[]` array** — exactly the convention `RouterBranchSchema`
 * already established via `next_node_id` — not inlined `GraphNode[]`/
 * `GraphNode[][]` sub-arrays. See the plan doc's Phase 11 section for the
 * full rationale (every existing flat-array scan — `toolRefsKnownRule`,
 * `findLlmNodes`, the session-detail node trace — already covers nodes
 * nested inside a Parallel branch or Loop body for free under this choice).
 */

const CredentialRef = T.String({ minLength: 1, maxLength: 256 });
const NodeId = T.String({ minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_-]+$' });

/** R-G2 — every node declares which lane it runs in. */
export const NodeLane = T.Union([T.Literal('foreground'), T.Literal('background')]);

/**
 * R-G7 — every node has an `on_error` edge; `on_deadline` also exists on
 * every node per the same rule, but deadline *enforcement* is Phase 10
 * (`ARCHITECTURE_NOTES.md` §3.3/§7's V-5 split) — this phase only carries
 * the field through unread by the interpreter.
 */
export const NodeEdge = T.Object({
  action: T.Union([T.Literal('goto'), T.Literal('end_turn'), T.Literal('degrade')]),
  target_node_id: T.Optional(NodeId),
});

const NodeBase = {
  id: NodeId,
  name: T.String({ minLength: 1, maxLength: 120 }),
  lane: NodeLane,
  on_error: NodeEdge,
  on_deadline: NodeEdge,
};

const LlmLeg = T.Object({
  provider: LlmProviderKey,
  credential_ref: T.Optional(CredentialRef),
  model: T.String({ minLength: 1, maxLength: 128 }),
});

export const RetryPolicySchema = T.Object({
  max_attempts: T.Integer({ minimum: 1, maximum: 5, default: 3 }),
  backoff_ms: T.Array(T.Integer({ minimum: 0, maximum: 60000 }), {
    minItems: 1,
    maxItems: 5,
    default: [200, 400, 800],
  }),
});

/** LLM node — carries the same provider/model/fallback/retry shape today's `llm` block has (R-G1). */
export const LlmNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('llm'),
  provider: LlmProviderKey,
  credential_ref: T.Optional(CredentialRef),
  model: T.String({ minLength: 1, maxLength: 128 }),
  fallback: T.Optional(LlmLeg),
  retry: RetryPolicySchema,
  next_node_id: T.Union([NodeId, T.Null()]),
});

/** Tool node — invokes a registered `ToolDefinition` by `api_ref`. */
export const ToolNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('tool'),
  api_ref: T.String({ minLength: 1, maxLength: 64 }),
  argument_mapping: T.Record(T.String({ minLength: 1, maxLength: 80 }), T.String({ maxLength: 500 }), { default: {} }),
  timeout_ms: T.Optional(T.Integer({ minimum: 100, maximum: 60000 })),
  next_node_id: T.Union([NodeId, T.Null()]),
});

/**
 * Retrieve node — **real, Phase 12b** (BL-045/047, `ARCHITECTURE_NOTES.md`
 * §3.2/§4.4). `source_refs`/`top_k` were stubbed in Phase 9; `budget_ms` is
 * new this phase — the node's own overall retrieval-latency ceiling (A3.2's
 * "latency budget" column), analogous to `ToolNodeSchema.timeout_ms`'s
 * worst-case-bound precedent, not a typical-latency estimate. The node
 * inherits the tenant's `knowledge.pipeline` wholesale (see the plan doc's
 * Phase 12b "Decisions made this phase" #1 for why there is no per-node
 * pipeline override this phase) — `budget_ms` is what V-10 checks
 * `knowledge.pipeline`'s summed per-stage `budget_ms` fields against, and
 * what `critical-path.ts` now reads as this node type's real cost (replacing
 * the Phase-9-era `DEFAULT_COST_MS.retrieve = 0` "stub, no-op" constant).
 */
export const RetrieveNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('retrieve'),
  source_refs: T.Array(T.String({ minLength: 1, maxLength: 256 }), { default: [] }),
  top_k: T.Integer({ minimum: 1, maximum: 20, default: 5 }),
  budget_ms: T.Integer({ minimum: 1, maximum: 60000, default: 400 }),
  next_node_id: T.Union([NodeId, T.Null()]),
});

/**
 * `knowledge.pipeline` — the six-stage retrieval pipeline config (Phase 12b,
 * BL-045/047; spec §A7.2/§A7.4). One pipeline per tenant, referenced
 * wholesale by every `retrieve`-type graph node (see `RetrieveNodeSchema`'s
 * doc comment). Every stage that does real work carries its own `budget_ms`
 * (R-R3) — Rerank does not, since it is a deferred (BL-070) no-op passthrough
 * this phase, never actually invoked, so it has no latency to budget for.
 */

/** ① Rewrite — optional LLM call using the last-N turns of conversation context (R-R5). */
export const RewriteStageSchema = T.Object({
  enabled: T.Boolean({ default: true }),
  context_turns: T.Integer({ minimum: 1, maximum: 10, default: 3 }),
  budget_ms: T.Integer({ minimum: 0, maximum: 10000, default: 150 }),
});

/** ② Hybrid search — always on, no toggle (per the wireframe); vector + keyword (BM25/`ts_rank`) blend (R-R4). */
export const HybridSearchStageSchema = T.Object({
  vector_weight: T.Number({ minimum: 0, maximum: 1, default: 0.6 }),
  keyword_weight: T.Number({ minimum: 0, maximum: 1, default: 0.4 }),
  candidates: T.Integer({ minimum: 1, maximum: 100, default: 20 }),
  budget_ms: T.Integer({ minimum: 0, maximum: 10000, default: 100 }),
});

/** ③ Metadata filter — a single field/op/value condition against `KnowledgeChunk.metadata`. */
export const MetadataFilterConditionSchema = T.Object({
  field: T.String({ minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_]+$' }),
  op: T.Union([T.Literal('eq'), T.Literal('neq'), T.Literal('contains')]),
  value: T.String({ minLength: 1, maxLength: 500 }),
});

export const MetadataFilterStageSchema = T.Object({
  enabled: T.Boolean({ default: false }),
  condition: T.Optional(MetadataFilterConditionSchema),
  budget_ms: T.Integer({ minimum: 0, maximum: 10000, default: 20 }),
});

/**
 * ④ Rerank — **explicitly deferred (BL-070)**. Rendered/stored as
 * present-but-disabled ("coming soon"), same pattern 12a used for PDF
 * parsing/semantic chunking — `enabled` is a fixed `false` literal (not a
 * recognized-but-unimplemented boolean an admin could flip to `true` and
 * have nothing happen), mirroring `JoinPolicySchema`'s "an absent value that
 * fails validation cleanly beats one the executor has no branch for"
 * precedent. No `budget_ms` — never actually invoked, so nothing to budget.
 */
export const RerankStageSchema = T.Object({
  enabled: T.Literal(false, { default: false }),
  keep_top: T.Optional(T.Integer({ minimum: 1, maximum: 50 })),
});

/** ⑤ Threshold — chunks below `min_score` are dropped, never passed with a low score (R-R7). */
export const ThresholdStageSchema = T.Object({
  min_score: T.Number({ minimum: 0, maximum: 1, default: 0.5 }),
  budget_ms: T.Integer({ minimum: 0, maximum: 10000, default: 10 }),
});

/** ⑥ Inject — token-capped, citation-formatted (R-R8). */
export const CitationFormatSchema = T.Union([T.Literal('numbered'), T.Literal('inline'), T.Literal('none')]);

export const InjectStageSchema = T.Object({
  token_cap: T.Integer({ minimum: 1, maximum: 8000, default: 1200 }),
  citation_format: CitationFormatSchema,
  budget_ms: T.Integer({ minimum: 0, maximum: 10000, default: 30 }),
});

export const RetrievalPipelineConfigSchema = T.Object({
  rewrite: RewriteStageSchema,
  hybrid_search: HybridSearchStageSchema,
  metadata_filter: MetadataFilterStageSchema,
  rerank: RerankStageSchema,
  threshold: ThresholdStageSchema,
  inject: InjectStageSchema,
});

/** `knowledge` top-level block (Phase 12b). No `sources[]` — `KnowledgeSource` is a separately-managed, DB-backed entity (12a), referenced by id via `RetrieveNodeSchema.source_refs`, never inlined (mirrors `agent.tools[]`/`ToolDefinition`). */
export const KnowledgeSchema = T.Object({
  pipeline: RetrievalPipelineConfigSchema,
});

/**
 * Router node — branches on a small allow-listed condition grammar (never
 * `eval`'d, see `apps/api/src/modules/deployment-config/domain/graph-condition.ts`
 * / `apps/agent/.../orchestration/graph/condition_grammar.py`).
 */
export const RouterBranchSchema = T.Object({
  condition: T.String({ minLength: 1, maxLength: 300 }),
  next_node_id: NodeId,
});

export const RouterNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('router'),
  branches: T.Array(RouterBranchSchema, { minItems: 1 }),
  default_next_node_id: NodeId,
});

/** Speak node — emits speech; `text` is required only in `literal` mode (checked by the validator, not the schema). */
export const SpeakNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('speak'),
  mode: T.Union([T.Literal('llm_output'), T.Literal('literal')]),
  text: T.Optional(T.String({ maxLength: 2000 })),
  interruptible: T.Boolean({ default: true }),
  next_node_id: T.Union([NodeId, T.Null()]),
});

/** End node — terminates the turn. */
export const EndNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('end'),
});

/**
 * Parallel node (Phase 11, BL-042) — fans out to `branches`, joins per
 * `join_policy`. Each branch is a single reference into the shared graph
 * (see this file's top docstring); `budget_ms` is the wireframe's
 * (§A3.7) optional per-branch budget. `best_of` (BL-069, judge-LLM pick) is
 * **deliberately omitted** from `JoinPolicySchema` rather than kept as a
 * recognized-but-unimplemented literal — see the plan doc for why an absent
 * value that fails validation cleanly beats one the executor has no branch
 * for.
 */
export const JoinPolicySchema = T.Union([
  T.Literal('all'),
  T.Literal('first_success'),
  T.Literal('quorum'),
  T.Literal('all_settled'),
]);

export const ParallelBranchSchema = T.Object({
  id: T.String({ minLength: 1, maxLength: 64, pattern: '^[a-zA-Z0-9_-]+$' }),
  entry_node_id: NodeId,
  budget_ms: T.Optional(T.Integer({ minimum: 1, maximum: 60000 })),
});

export const ParallelNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('parallel'),
  branches: T.Array(ParallelBranchSchema, { minItems: 1 }),
  join_policy: JoinPolicySchema,
  /**
   * Required only when `join_policy === 'quorum'` — a structural (not
   * schema-shape) check, mirrors the pre-existing Speak-node-`text`
   * precedent ("required only in `literal` mode, checked by the validator").
   * See `graph-structure.ts`'s `CONFIG_GRAPH_QUORUM_N_INVALID` check.
   */
  quorum_n: T.Optional(T.Integer({ minimum: 1 })),
  on_branch_error: T.Union([T.Literal('continue_partial'), T.Literal('fail')]),
  next_node_id: T.Union([NodeId, T.Null()]),
});

/**
 * Loop node (Phase 11, BL-043) — repeats `body_entry_node_id`'s chain until
 * `condition` holds (reuses the Router condition grammar verbatim, never a
 * second evaluator). All three guards are **mandatory** (R-G4) and are
 * schema-required fields with deliberately unconstrained numeric ranges —
 * V-2 (`graph-rules.ts`) is what actually enforces "positive"; see this
 * file's top docstring / the plan doc for why "present" alone is already
 * guaranteed by ordinary TypeBox requiredness.
 *
 * **`max_cost` unit**: abstract cost units, where one unit = one node
 * executed during a single loop-body pass — no per-call/per-token
 * dollar-cost concept exists anywhere else in this codebase to reuse
 * instead (checked before inventing this; see the plan doc).
 *
 * **Upper bounds** (security hardening, added alongside the phase's own
 * security review — see the plan doc): V-2 enforces the *lower* bound
 * (positive), but nothing previously stopped an admin from configuring an
 * absurdly large guard (e.g. `max_iterations: 10_000_000`). The outer
 * turn-level deadline (`turn_budget_ms`, itself capped at 60000ms) already
 * bounds worst-case wall-clock time regardless, but a sane upper ceiling
 * here is cheap, additive, defense-in-depth, and mirrors this schema's own
 * existing precedent for bounding admin-configurable numeric fields (e.g.
 * `ToolNodeSchema.timeout_ms`). `max_duration_ms`'s ceiling matches
 * `turn_budget_ms`'s own maximum — a loop can never legitimately need more
 * duration than the entire turn's own ceiling.
 */
export const LoopNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('loop'),
  body_entry_node_id: NodeId,
  condition: T.String({ minLength: 1, maxLength: 300 }),
  max_iterations: T.Integer({ maximum: 1000 }),
  max_duration_ms: T.Integer({ maximum: 60000 }),
  max_cost: T.Number({ maximum: 100000 }),
  next_node_id: T.Union([NodeId, T.Null()]),
});

/**
 * Skill node (Phase 13, BL-049/050/051; `ARCHITECTURE_NOTES.md` §5.3/§3.2).
 * References a `Skill`/`SkillVersion` by id — never inlines its body
 * (mirrors `ToolNodeSchema.api_ref`'s by-reference convention). `version`
 * accepts `"latest"` at authoring time (an admin picks "always the newest
 * published version" in the editor); `GetRuntimeConfigUseCase` resolves
 * this to a concrete published version number **once, at session-start
 * read time** — the same "resolve once per session" discipline already
 * applied to `agent.tools[]`/the reasoning graph — so a live session's
 * config never actually carries the literal string `"latest"` through to
 * the interpreter (the executor treats that as a defensive, should-never-
 * happen condition). `budget_ms` is this node's own declared latency
 * budget (R-S5 — "counted on the critical path of any branch that can
 * reach it"), independent of whatever `SkillVersion.budgetMs` says,
 * exactly the same "node carries its own scalar cost field" precedent
 * `RetrieveNodeSchema.budget_ms` already set (`critical-path.ts` has no DB
 * access, so it cannot resolve the skill's own stored budget at
 * compute time).
 */
export const SkillNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('skill'),
  skill_id: T.String({ minLength: 1, maxLength: 64 }),
  version: T.Union([T.Integer({ minimum: 1 }), T.Literal('latest')]),
  budget_ms: T.Integer({ minimum: 1, maximum: 60000, default: 1500 }),
  next_node_id: T.Union([NodeId, T.Null()]),
});

/**
 * HITL node (Phase 14, BL-052/053; `ARCHITECTURE_NOTES.md` §6). References a
 * `HitlGate` by id — never inlines gate config, mirrors `SkillNodeSchema`'s
 * by-reference convention (the gate's own `attachmentKind: 'graph_node'` +
 * `attachmentRef` link back the other way, resolved by the `hitl` module,
 * not by this schema). Deliberately carries **no** `budget_ms`: R-H4 marks
 * any path through a blocking gate as *unbounded* rather than estimated
 * (see `critical-path.ts`'s `hitl` strategy entry) — a numeric per-node cost
 * field would misrepresent the one thing this node type is defined by.
 */
export const HitlNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('hitl'),
  gate_id: T.String({ minLength: 1, maxLength: 64 }),
  next_node_id: T.Union([NodeId, T.Null()]),
});

/**
 * Sub-agent node (Phase 15, BL-058; `ARCHITECTURE_NOTES.md` §3.2). This
 * codebase has no separate "Agent" entity — a tenant *is* the agent, 1:1,
 * via `DeploymentConfig` (`@unique` on `tenantId`) — so "delegate to
 * another agent" means delegate to **another tenant's published config**.
 * `target_tenant_id` references that tenant by id, never inlines its
 * config (the by-reference convention every other node type here already
 * follows). R-G6/V-3 (nesting ≤ 2 levels) is enforced at publish time in
 * `graph-rules.ts`, cross-tenant.
 *
 * **v1 runtime scope (mirrors `SkillNodeSchema`'s own precedent
 * verbatim)**: delegation runs **one bounded LLM turn** using the target
 * tenant's system prompt + tools, not a full nested graph/interpreter
 * invocation — BL-058 itself is scoped as a "completeness item," the same
 * "not a nested sub-graph" simplification Phase 13 already made for
 * Skills, for the same reason (a full nested interpreter is a materially
 * larger feature than this item's own scope). `handback_policy` governs
 * what happens to the delegated turn's own output: `speak_and_return`
 * speaks it to the caller directly (mirrors the orchestration-pattern
 * diagram's "hands back with a result"); `silent_return` returns it into
 * `turn_state` for the *parent* graph to decide what to do with (mirrors
 * how a Tool/Skill node's own output is already referenceable downstream),
 * never auto-spoken.
 */
export const SubAgentNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('subagent'),
  target_tenant_id: T.String({ format: 'uuid' }),
  handback_policy: T.Union([T.Literal('speak_and_return'), T.Literal('silent_return')]),
  budget_ms: T.Integer({ minimum: 1, maximum: 60000, default: 4000 }),
  next_node_id: T.Union([NodeId, T.Null()]),
});

/**
 * Handoff node (Phase 15, BL-059; `ARCHITECTURE_NOTES.md` §3.2) — "Transfer
 * to a human." v1 ships **intent only**: record the handoff, transition
 * session-scoped state, fire an alert — real PSTN/SIP transfer mechanics
 * are a telephony-integration decision explicitly outside this design's
 * scope. Deliberately has **no `next_node_id`**: this codebase's own
 * `end`-type node is the only other node with no continuation, and
 * "transfer to a human" is a turn-terminal action in the exact same sense
 * — there is nothing left for *this* turn's graph walk to do once control
 * has left the AI (a future phase adding real transfer mechanics doesn't
 * need this shape to change; it just makes the transfer real instead of
 * recorded-intent-only).
 */
export const HandoffNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('handoff'),
  destination: T.String({ minLength: 1, maxLength: 200 }),
  context_summary: T.String({ maxLength: 2000 }),
});

/**
 * State node (Phase 15, BL-060; `ARCHITECTURE_NOTES.md` §3.2) —
 * session-scoped variable read/write, **in-memory only** (no Postgres
 * write path — "no clear v1 consumer justifies the write load of
 * persisting every State write"). Deliberately carries **no `scope`
 * field**: A3.2 lists "scope" among this node's settings, but v1 has
 * exactly one legal value (session-scoped) and no second one to choose
 * between — same "don't add a recognized-but-unimplemented choice"
 * discipline `RerankStageSchema`'s fixed `enabled: false` literal and
 * `JoinPolicySchema`'s omitted `best_of` already establish elsewhere in
 * this file. `value` is required only for `mode: 'write'` (checked by the
 * validator, not the schema — the same "required only in one mode"
 * precedent `SpeakNodeSchema.text` already sets) and supports the same
 * `$`-prefixed reference syntax `ToolNodeSchema.argument_mapping` already
 * uses (e.g. `$<node_id>`) so a State write can capture another node's
 * output, not just a literal.
 */
export const StateNodeSchema = T.Object({
  ...NodeBase,
  type: T.Literal('state'),
  mode: T.Union([T.Literal('read'), T.Literal('write')]),
  variable: T.String({ minLength: 1, maxLength: 80, pattern: '^[a-zA-Z0-9_]+$' }),
  value: T.Optional(T.String({ maxLength: 2000 })),
  next_node_id: T.Union([NodeId, T.Null()]),
});

export const GraphNodeSchema = T.Union([
  LlmNodeSchema,
  ToolNodeSchema,
  RetrieveNodeSchema,
  RouterNodeSchema,
  SpeakNodeSchema,
  EndNodeSchema,
  ParallelNodeSchema,
  LoopNodeSchema,
  SkillNodeSchema,
  HitlNodeSchema,
  SubAgentNodeSchema,
  HandoffNodeSchema,
  StateNodeSchema,
]);

/**
 * `skills[]` — the agent-level "attached" skill list (Phase 13,
 * `ARCHITECTURE_NOTES.md` §5.3), the top-level analog of `agent.tools[]`:
 * a skill referenced here contributes its `name`+`description` blurb to
 * the base prompt (R-S1/R-S7's ~15-token cost), independent of whether a
 * `skill`-type graph node also exists to route into it. `version` follows
 * the exact same `number | "latest"` authoring/resolution split as
 * `SkillNodeSchema.version` above.
 */
export const SkillRefSchema = T.Object({
  id: T.String({ minLength: 1, maxLength: 64 }),
  version: T.Union([T.Integer({ minimum: 1 }), T.Literal('latest')]),
});

/**
 * `reasoning` block. `entry_node_id` is the foreground walk's start node;
 * `background_entry_node_ids` are separate entry points for nodes that run
 * detached after the foreground path speaks (R-G2, UC-G2) — a background
 * node is never reached via a foreground node's `next_node_id`
 * (`ARCHITECTURE_NOTES.md` §3.1, this plan's "Decisions made this phase").
 */
export const ReasoningSchema = T.Object({
  graph: T.Array(GraphNodeSchema, { minItems: 1 }),
  entry_node_id: NodeId,
  background_entry_node_ids: T.Array(NodeId, { default: [] }),
  turn_budget_ms: T.Integer({ minimum: 100, maximum: 60000, default: 3000 }),
});

export type LlmNode = Static<typeof LlmNodeSchema>;
export type ToolNode = Static<typeof ToolNodeSchema>;
export type RetrieveNode = Static<typeof RetrieveNodeSchema>;
export type RouterNode = Static<typeof RouterNodeSchema>;
export type SpeakNode = Static<typeof SpeakNodeSchema>;
export type EndNode = Static<typeof EndNodeSchema>;
export type ParallelBranch = Static<typeof ParallelBranchSchema>;
export type JoinPolicy = Static<typeof JoinPolicySchema>;
export type ParallelNode = Static<typeof ParallelNodeSchema>;
export type LoopNode = Static<typeof LoopNodeSchema>;
export type GraphNode = Static<typeof GraphNodeSchema>;
export type Reasoning = Static<typeof ReasoningSchema>;
export type NodeEdgeType = Static<typeof NodeEdge>;
export type RewriteStage = Static<typeof RewriteStageSchema>;
export type HybridSearchStage = Static<typeof HybridSearchStageSchema>;
export type MetadataFilterCondition = Static<typeof MetadataFilterConditionSchema>;
export type MetadataFilterStage = Static<typeof MetadataFilterStageSchema>;
export type RerankStage = Static<typeof RerankStageSchema>;
export type ThresholdStage = Static<typeof ThresholdStageSchema>;
export type CitationFormat = Static<typeof CitationFormatSchema>;
export type InjectStage = Static<typeof InjectStageSchema>;
export type RetrievalPipelineConfig = Static<typeof RetrievalPipelineConfigSchema>;
export type Knowledge = Static<typeof KnowledgeSchema>;
export type SkillNode = Static<typeof SkillNodeSchema>;
export type SkillRef = Static<typeof SkillRefSchema>;
export type HitlNode = Static<typeof HitlNodeSchema>;
export type SubAgentNode = Static<typeof SubAgentNodeSchema>;
export type HandoffNode = Static<typeof HandoffNodeSchema>;
export type StateNode = Static<typeof StateNodeSchema>;
