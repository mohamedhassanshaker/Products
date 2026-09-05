import { Type, type Static } from '@sinclair/typebox';

/** `draft` persists even when incomplete; `published` must pass both validation gates. */
export const ConfigStatusSchema = Type.Union([Type.Literal('draft'), Type.Literal('published')]);

/** Inferred config status. */
export type ConfigStatus = Static<typeof ConfigStatusSchema>;

/**
 * `POST /tenants/:id/config/validate` body — either raw YAML text or the
 * already-structured form (Agent Builder posts structured; a hand-edited-YAML
 * path posts text). Exactly one of the two must be present; enforced in the
 * use case rather than the schema so both branches share one 200 response
 * shape (FR-CONFIG-3/4).
 */
export const ValidateConfigRequestSchema = Type.Object({
  yaml_text: Type.Optional(Type.String({ maxLength: 200_000 })),
  config: Type.Optional(Type.Unknown()),
});

/** Inferred validate request. */
export type ValidateConfigRequest = Static<typeof ValidateConfigRequestSchema>;

/** One field/layer-level validation error (FR-CONFIG-3/4). */
export const ConfigErrorSchema = Type.Object({
  code: Type.String(),
  layer: Type.Optional(Type.String()),
  field: Type.Optional(Type.String()),
  message: Type.String(),
  /**
   * Phase 12b (BL-045/047, `ARCHITECTURE_NOTES.md` §7's V-11 note) — added
   * one phase early so V-9 can be "warn, not block" (see the plan doc's
   * Phase 12b "Decisions made this phase" #4). Optional so every pre-12b
   * rule's output (no `severity` field at all) is unaffected; absent is
   * treated as blocking, same as every rule behaved before this field
   * existed. Every other Gate B rule still omits it, i.e. still blocks.
   */
  severity: Type.Optional(Type.Union([Type.Literal('error'), Type.Literal('warning')])),
});

/** Inferred config error item. */
export type ConfigErrorDto = Static<typeof ConfigErrorSchema>;

/** Per-layer resolved provider summary shown in the live preview (FR-CONFIG-4). */
export const ResolvedLayerSchema = Type.Object({
  provider: Type.Union([Type.String(), Type.Null()]),
  hosting: Type.Union([Type.String(), Type.Null()]),
  has_secret: Type.Boolean(),
  feature_gaps: Type.Union([Type.String(), Type.Null()]),
});

/** Inferred resolved-layer summary. */
export type ResolvedLayerDto = Static<typeof ResolvedLayerSchema>;

/**
 * Phase 10 (BL-040/041, `docs/v2/ARCHITECTURE_NOTES.md` §3.3) — critical-path
 * computation, exposed via `/config/validate` so the Reasoning tab's turn
 * budget panel (§A4.3) has data to render: the single longest (critical)
 * path plus every enumerated path from `reasoning.entry_node_id` to a
 * terminal node.
 */
export const CriticalPathStepSchema = Type.Object({
  node_id: Type.String(),
  node_type: Type.String(),
  name: Type.String(),
  lane: Type.Union([Type.Literal('foreground'), Type.Literal('background')]),
  cost_ms: Type.Integer(),
  /** Phase 14 (R-H4) — true only for a `hitl` step. */
  unbounded: Type.Optional(Type.Boolean()),
});
export type CriticalPathStepDto = Static<typeof CriticalPathStepSchema>;

export const CriticalPathGraphPathSchema = Type.Object({
  steps: Type.Array(CriticalPathStepSchema),
  total_ms: Type.Integer(),
  over_budget: Type.Boolean(),
  /** Phase 14 (R-H4) — this path passes through a HITL node; `total_ms`/`over_budget` are informational only. */
  unbounded: Type.Boolean(),
});
export type CriticalPathGraphPathDto = Static<typeof CriticalPathGraphPathSchema>;

export const CriticalPathReportSchema = Type.Object({
  critical_path_ms: Type.Integer(),
  turn_budget_ms: Type.Integer(),
  over_budget: Type.Boolean(),
  /** Phase 14 (R-H4) — at least one enumerated path passes through a HITL node. */
  has_unbounded_path: Type.Boolean(),
  paths: Type.Array(CriticalPathGraphPathSchema),
});
export type CriticalPathReportDto = Static<typeof CriticalPathReportSchema>;

/** `POST /tenants/:id/config/validate` response — always 200; validity is in the body. */
export const ValidateConfigResponseSchema = Type.Object({
  valid: Type.Boolean(),
  errors: Type.Array(ConfigErrorSchema),
  resolved: Type.Record(Type.String(), ResolvedLayerSchema),
  redacted_yaml: Type.String(),
  /**
   * `null` when `reasoning` is absent entirely, or Gate A's own schema
   * check failed (computing a path over a structurally-invalid graph isn't
   * meaningful — see `ValidateConfigUseCase.execute`).
   */
  critical_path: Type.Union([CriticalPathReportSchema, Type.Null()]),
});

/** Inferred validate response. */
export type ValidateConfigResponseDto = Static<typeof ValidateConfigResponseSchema>;

/** `PUT /tenants/:id/config` body (FR-CONFIG-3). */
export const SaveConfigRequestSchema = Type.Object({
  yaml_text: Type.Optional(Type.String({ maxLength: 200_000 })),
  config: Type.Optional(Type.Unknown()),
  save_as: ConfigStatusSchema,
});

/** Inferred save request. */
export type SaveConfigRequest = Static<typeof SaveConfigRequestSchema>;

/** `GET/PUT /tenants/:id/config` response resource. */
export const DeploymentConfigSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenant_id: Type.String({ format: 'uuid' }),
  yaml_text: Type.String(),
  status: ConfigStatusSchema,
  providers: Type.Object({
    transport: Type.Union([Type.String(), Type.Null()]),
    stt: Type.Union([Type.String(), Type.Null()]),
    llm: Type.Union([Type.String(), Type.Null()]),
    llm_fallback: Type.Union([Type.String(), Type.Null()]),
    tts: Type.Union([Type.String(), Type.Null()]),
    avatar: Type.Union([Type.String(), Type.Null()]),
  }),
  updated_at: Type.String(),
  updated_by: Type.Union([Type.String(), Type.Null()]),
  published_at: Type.Union([Type.String(), Type.Null()]),
});

/** Deployment config DTO. */
export type DeploymentConfigDto = Static<typeof DeploymentConfigSchema>;

/**
 * Phase 9 (BL-035, `ARCHITECTURE_NOTES.md` §2) — `ConfigVersion` read/rollback
 * surface. The diff/rollback **UI** is deferred (BL-078); these DTOs back the
 * backend capability only.
 */
export const ConfigVersionStatusSchema = Type.Union([
  Type.Literal('published'),
  Type.Literal('superseded'),
  Type.Literal('rolled_back'),
]);
export type ConfigVersionStatus = Static<typeof ConfigVersionStatusSchema>;

/** `GET /tenants/:id/config/versions` list item — no `yaml_text` (fetched via diff, keeps the list light). */
export const ConfigVersionSummarySchema = Type.Object({
  version_number: Type.Integer(),
  status: ConfigVersionStatusSchema,
  published_at: Type.String(),
  created_by: Type.Union([Type.String(), Type.Null()]),
  rolled_back_from: Type.Union([Type.Integer(), Type.Null()]),
});
export type ConfigVersionSummaryDto = Static<typeof ConfigVersionSummarySchema>;

export const ListConfigVersionsResponseSchema = Type.Object({ versions: Type.Array(ConfigVersionSummarySchema) });
export type ListConfigVersionsResponseDto = Static<typeof ListConfigVersionsResponseSchema>;

/** `GET /tenants/:id/config/versions/diff?from=N&to=M` — a line-level diff, computed at read time. */
export const ConfigVersionDiffLineSchema = Type.Object({
  op: Type.Union([Type.Literal('equal'), Type.Literal('add'), Type.Literal('remove')]),
  text: Type.String(),
});
export const ConfigVersionDiffResponseSchema = Type.Object({
  from: Type.Integer(),
  to: Type.Integer(),
  lines: Type.Array(ConfigVersionDiffLineSchema),
});
export type ConfigVersionDiffResponseDto = Static<typeof ConfigVersionDiffResponseSchema>;

/** `POST /tenants/:id/config/versions/:versionNumber/rollback` — creates a new draft, never auto-publishes. */
export const RollbackConfigVersionResponseSchema = Type.Object({ config: DeploymentConfigSchema });
export type RollbackConfigVersionResponseDto = Static<typeof RollbackConfigVersionResponseSchema>;

/**
 * Phase 9 (BL-037) — shared "Test call" harness. Runs as a NestJS-side
 * structural simulation of the graph (see the plan doc's "Decisions made
 * this phase") — Tool nodes call the real `ToolInvokerService`; LLM nodes
 * are simulated (no live vendor call, no credential resolution in the
 * control plane); Router/Retrieve/Speak/End are evaluated/rendered directly.
 */
export const TestCallRequestSchema = Type.Object({
  config: Type.Unknown(),
  utterance: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type TestCallRequest = Static<typeof TestCallRequestSchema>;

export const TestCallNodeResultSchema = Type.Object({
  node_id: Type.String(),
  node_type: Type.String(),
  lane: Type.String(),
  status: Type.Union([Type.Literal('complete'), Type.Literal('failed'), Type.Literal('skipped')]),
  simulated: Type.Boolean(),
  summary: Type.String(),
  detail: Type.Optional(Type.String()),
});
export type TestCallNodeResultDto = Static<typeof TestCallNodeResultSchema>;

export const TestCallResponseSchema = Type.Object({
  ok: Type.Boolean(),
  final_text: Type.Union([Type.String(), Type.Null()]),
  nodes: Type.Array(TestCallNodeResultSchema),
  errors: Type.Array(ConfigErrorSchema),
});
export type TestCallResponseDto = Static<typeof TestCallResponseSchema>;
