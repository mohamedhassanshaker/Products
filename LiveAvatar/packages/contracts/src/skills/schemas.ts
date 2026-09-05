import { Type, type Static } from '@sinclair/typebox';

/**
 * `skills` module wire contracts (Phase 13, BL-049/050/051 —
 * `docs/v2/BACKLOG.md`; `ARCHITECTURE_NOTES.md` §5). Mirrors `tools/schemas.ts`'s
 * shape: full CRUD for the tenant-scoped `Skill`/`SkillVersion` aggregate.
 *
 * A `Skill` row is identity + "which version is currently live" only
 * (`current_published_version`); content (description/instructions/tools/
 * knowledge filters/budget) lives entirely on `SkillVersion` rows, exactly
 * per `ARCHITECTURE_NOTES.md` §5.1's given schema. At any time a `Skill`
 * has at most one mutable **draft** `SkillVersion` (the one an admin is
 * editing) and at most one **published** version (immutable, R-S3) — see
 * `apps/api/src/modules/skills/domain/skill.ts` for the full lifecycle.
 */

export const SkillTriggerModeSchema = Type.Union([Type.Literal('model'), Type.Literal('router')]);
export type SkillTriggerMode = Static<typeof SkillTriggerModeSchema>;

export const SkillVersionStatusSchema = Type.Union([Type.Literal('draft'), Type.Literal('published')]);
export type SkillVersionStatus = Static<typeof SkillVersionStatusSchema>;

/**
 * A skill's own knowledge-retrieval scoping (A5.5's wireframe: "filter:
 * section = 'refunds' · top-k 3 · threshold 0.75") — a metadata-filter
 * *condition* reference against the tenant's existing `knowledge.pipeline`,
 * never a second retrieval pipeline of its own (see the plan doc's Phase
 * 13 follow-up note carried from Phase 12b).
 */
export const SkillKnowledgeFilterSchema = Type.Object({
  source_refs: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { default: [] }),
  top_k: Type.Optional(Type.Integer({ minimum: 1, maximum: 20 })),
  min_score: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
});
export type SkillKnowledgeFilter = Static<typeof SkillKnowledgeFilterSchema>;

const SkillVersionContentFields = {
  description: Type.String({ minLength: 1, maxLength: 500 }),
  instructions: Type.String({ maxLength: 32768 }),
  trigger_mode: SkillTriggerModeSchema,
  /** `api_ref` strings — never inlined `ToolDefinition` rows (mirrors `agent.tools[]`). */
  tools: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { default: [] }),
  knowledge_filters: SkillKnowledgeFilterSchema,
  budget_ms: Type.Integer({ minimum: 1, maximum: 60000 }),
  /**
   * Phase 14 follow-up (BL-052, R-S6) — an optional `HitlGate` id this skill
   * declares for itself (`attachmentKind: 'skill'`), so the gate "travels
   * with" the skill wherever it's invoked. Never inlined — resolved by id
   * against the `hitl` module, mirrors `tools`'s by-reference convention.
   * `null` means no gate attached (the common case).
   */
  hitl_gate_id: Type.Union([Type.String({ minLength: 1, maxLength: 64 }), Type.Null()]),
  environments: Type.Array(Type.Union([Type.Literal('dev'), Type.Literal('staging'), Type.Literal('production')]), {
    default: ['dev', 'staging', 'production'],
  }),
};

/** `POST /tenants/:id/skills` body — creates the `Skill` row plus its v1 draft `SkillVersion` in one call. */
export const CreateSkillRequestSchema = Type.Object(
  {
    name: Type.String({ minLength: 1, maxLength: 80 }),
    description: Type.Optional(SkillVersionContentFields.description),
    instructions: Type.Optional(Type.String({ maxLength: 32768 })),
    trigger_mode: Type.Optional(SkillTriggerModeSchema),
    tools: Type.Optional(SkillVersionContentFields.tools),
    knowledge_filters: Type.Optional(SkillKnowledgeFilterSchema),
    budget_ms: Type.Optional(SkillVersionContentFields.budget_ms),
    hitl_gate_id: Type.Optional(SkillVersionContentFields.hitl_gate_id),
    environments: Type.Optional(SkillVersionContentFields.environments),
  },
  { additionalProperties: false },
);
export type CreateSkillRequest = Static<typeof CreateSkillRequestSchema>;

/**
 * `PATCH /tenants/:id/skills/:skillId/draft` body — every field optional.
 * `name` renames the `Skill` row itself; every other field patches the
 * current draft `SkillVersion` (auto-forked from the published content if
 * no draft exists yet — see the skills module's own docstring).
 */
export const UpdateSkillDraftRequestSchema = Type.Object(
  {
    name: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
    description: Type.Optional(SkillVersionContentFields.description),
    instructions: Type.Optional(SkillVersionContentFields.instructions),
    trigger_mode: Type.Optional(SkillTriggerModeSchema),
    tools: Type.Optional(SkillVersionContentFields.tools),
    knowledge_filters: Type.Optional(SkillKnowledgeFilterSchema),
    budget_ms: Type.Optional(SkillVersionContentFields.budget_ms),
    hitl_gate_id: Type.Optional(SkillVersionContentFields.hitl_gate_id),
    environments: Type.Optional(SkillVersionContentFields.environments),
  },
  { additionalProperties: false },
);
export type UpdateSkillDraftRequest = Static<typeof UpdateSkillDraftRequestSchema>;

/** Full `SkillVersion` row, admin-CRUD shape (the editor's own fetch — includes `instructions`, unlike the runtime's progressive-disclosure summary). */
export const SkillVersionSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  version_number: Type.Integer(),
  status: SkillVersionStatusSchema,
  name: Type.String(),
  description: Type.String(),
  instructions: Type.String(),
  trigger_mode: SkillTriggerModeSchema,
  tools: Type.Array(Type.String()),
  knowledge_filters: SkillKnowledgeFilterSchema,
  budget_ms: Type.Integer(),
  hitl_gate_id: Type.Union([Type.String(), Type.Null()]),
  environments: Type.Array(Type.String()),
  published_at: Type.Union([Type.String(), Type.Null()]),
  created_by: Type.Union([Type.String(), Type.Null()]),
  created_at: Type.String(),
});
export type SkillVersionDto = Static<typeof SkillVersionSchema>;

/** `Skill` row + its draft/published version bodies — `GET`/list response shape. */
export const SkillSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenant_id: Type.String({ format: 'uuid' }),
  name: Type.String(),
  slug: Type.String(),
  draft_version: Type.Union([SkillVersionSchema, Type.Null()]),
  published_version: Type.Union([SkillVersionSchema, Type.Null()]),
  /**
   * How many agents currently reference this skill (`skills[]` or a
   * `skill`-type graph node) in their live (draft or published)
   * `DeploymentConfig`. Bounded to 0/1 today by this codebase's own
   * one-`DeploymentConfig`-row-per-tenant data model (a `Skill` is
   * tenant-scoped, and a tenant has exactly one agent config) — the
   * mechanism is real and will become meaningful the moment a future
   * phase introduces multiple agent configs per tenant; see the plan
   * doc's Phase 13 "Decisions made this phase" note.
   */
  used_by_agent_count: Type.Integer({ minimum: 0 }),
  created_at: Type.String(),
  updated_at: Type.String(),
});
export type SkillDto = Static<typeof SkillSchema>;

export const ListSkillsResponseSchema = Type.Object({ items: Type.Array(SkillSchema) });
export type ListSkillsResponseDto = Static<typeof ListSkillsResponseSchema>;

/** `GET /tenants/:id/skills/:skillId/usage` — the pre-publish "used by N agents" warning (A5.3 UC-S2). */
export const SkillUsageResponseSchema = Type.Object({ used_by_agent_count: Type.Integer({ minimum: 0 }) });
export type SkillUsageResponseDto = Static<typeof SkillUsageResponseSchema>;

/** `POST /tenants/:id/skills/:skillId/publish` — no body; publishes the current draft, response mirrors `GET`. */
export const PublishSkillResponseSchema = Type.Object({ skill: SkillSchema });
export type PublishSkillResponseDto = Static<typeof PublishSkillResponseSchema>;
