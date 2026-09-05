import { Type, type Static } from '@sinclair/typebox';

/** HTTP method a tool call is made with. */
export const ToolMethodSchema = Type.Union([
  Type.Literal('GET'),
  Type.Literal('POST'),
  Type.Literal('PUT'),
  Type.Literal('PATCH'),
  Type.Literal('DELETE'),
]);

/** Inferred tool HTTP method. */
export type ToolMethod = Static<typeof ToolMethodSchema>;

/**
 * A tool's execution lane (R-T3, `docs/v2/AgentBuilder_Reasoning_Skills_RAG_Orchestration_HITL.md`
 * §A6.1): a `background` tool never blocks speech. Kept a plain validated
 * string column on `ToolDefinition` (not a Prisma enum) — see
 * `docs/plans/agent-builder-v2-plan.md` Phase 8 "Decisions made this phase".
 */
export const ToolLaneSchema = Type.Union([Type.Literal('foreground'), Type.Literal('background')]);

/** Inferred tool lane. */
export type ToolLane = Static<typeof ToolLaneSchema>;

/** Shared field set for create/update bodies (LLD-style: create is required, update is Partial). */
const ToolFields = {
  name: Type.String({ minLength: 1, maxLength: 80 }),
  description: Type.Optional(Type.Union([Type.String({ maxLength: 500 }), Type.Null()])),
  method: ToolMethodSchema,
  url: Type.String({ minLength: 1, maxLength: 2048 }),
  credential_ref: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 256 }), Type.Null()])),
  args_schema: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  enabled: Type.Optional(Type.Boolean()),
  consequential: Type.Optional(Type.Boolean()),
  /**
   * Phase 14 (BL-057, V-6) — a deliberate, written opt-out of HITL gating
   * for a `consequential: true` tool that has no `HitlGate` attached.
   * Required by the application layer only in that combination.
   */
  autonomous_use_ack_text: Type.Optional(Type.Union([Type.String({ minLength: 1, maxLength: 1000 }), Type.Null()])),
  /** Admin-declared, not inferred — mirrors `ProviderDefinitionDto.requires_credential`. */
  requires_credential: Type.Optional(Type.Boolean()),
  lane: Type.Optional(ToolLaneSchema),
  per_session_cap: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  per_turn_cap: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  timeout_ms: Type.Optional(Type.Integer({ minimum: 100, maximum: 60000 })),
};

/** `POST /tenants/:id/tools` body (BL-033). `api_ref` is server-derived from `name` if omitted. */
export const CreateToolRequestSchema = Type.Object(
  {
    ...ToolFields,
    api_ref: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
  },
  { additionalProperties: false },
);

/** Inferred create-tool request. */
export type CreateToolRequest = Static<typeof CreateToolRequestSchema>;

/** `PATCH /tenants/:id/tools/:toolId` body — same fields, all optional (`api_ref` immutable). */
export const UpdateToolRequestSchema = Type.Object(
  {
    name: Type.Optional(ToolFields.name),
    description: ToolFields.description,
    method: Type.Optional(ToolFields.method),
    url: Type.Optional(ToolFields.url),
    credential_ref: ToolFields.credential_ref,
    args_schema: ToolFields.args_schema,
    enabled: ToolFields.enabled,
    consequential: ToolFields.consequential,
    autonomous_use_ack_text: ToolFields.autonomous_use_ack_text,
    requires_credential: ToolFields.requires_credential,
    lane: ToolFields.lane,
    per_session_cap: ToolFields.per_session_cap,
    per_turn_cap: ToolFields.per_turn_cap,
    timeout_ms: ToolFields.timeout_ms,
  },
  { additionalProperties: false },
);

/** Inferred update-tool request. */
export type UpdateToolRequest = Static<typeof UpdateToolRequestSchema>;

/** `ToolDefinition` row as returned to the admin UI. */
export const ToolSchema = Type.Object({
  id: Type.String({ format: 'uuid' }),
  tenant_id: Type.String({ format: 'uuid' }),
  api_ref: Type.String(),
  name: Type.String(),
  description: Type.Union([Type.String(), Type.Null()]),
  method: Type.String(),
  url: Type.String(),
  credential_ref: Type.Union([Type.String(), Type.Null()]),
  args_schema: Type.Record(Type.String(), Type.Unknown()),
  enabled: Type.Boolean(),
  consequential: Type.Boolean(),
  autonomous_use_ack_text: Type.Union([Type.String(), Type.Null()]),
  requires_credential: Type.Boolean(),
  lane: ToolLaneSchema,
  per_session_cap: Type.Union([Type.Integer(), Type.Null()]),
  per_turn_cap: Type.Union([Type.Integer(), Type.Null()]),
  timeout_ms: Type.Integer(),
  created_at: Type.String(),
  updated_at: Type.String(),
});

/** Tool DTO. */
export type ToolDto = Static<typeof ToolSchema>;

/** `POST /tenants/:id/tools/:toolId/test-invoke` body — sample arguments for the call. */
export const TestInvokeToolRequestSchema = Type.Object(
  {
    arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  },
  { additionalProperties: false },
);

/** Inferred test-invoke request. */
export type TestInvokeToolRequest = Static<typeof TestInvokeToolRequestSchema>;

/**
 * Test-invoke result. Mirrors `ToolExecutor.invoke()`'s failure-is-not-a-5xx
 * semantics (`apps/agent/src/avatar_agent/orchestration/tools.py`) — a tool
 * timeout or HTTP error is a normal (200) response from this endpoint,
 * `ok: false` and `error_code` set, so the admin UI can show exactly what the
 * live runtime would have seen instead of surfacing a generic API failure.
 */
export const TestInvokeToolResultSchema = Type.Object({
  ok: Type.Boolean(),
  status: Type.Optional(Type.Integer()),
  duration_ms: Type.Integer(),
  /** Response body text, size-capped and truncated the same way the runtime caps it. */
  body: Type.Optional(Type.String()),
  truncated: Type.Optional(Type.Boolean()),
  error_code: Type.Optional(Type.Union([Type.Literal('TOOL_TIMEOUT'), Type.Literal('TOOL_HTTP_ERROR')])),
  /**
   * True when the tool declares a `credential_ref` but this call was sent
   * with no `Authorization` header — the control plane never holds a
   * resolved secret value (only the live agent process does, from its own
   * `SECRETS_DIR` mount, per LLD §7.4); a test-invoke against an
   * authenticated tool is therefore expected to come back 401/403 unless
   * the endpoint tolerates anonymous calls.
   */
  credential_unresolved: Type.Optional(Type.Boolean()),
});

/** Test-invoke result DTO. */
export type TestInvokeToolResultDto = Static<typeof TestInvokeToolResultSchema>;

/** `GET /tenants/:id/tools` collection envelope. */
export const ListToolsResponseSchema = Type.Object({
  items: Type.Array(ToolSchema),
});

/** List-tools response DTO. */
export type ListToolsResponseDto = Static<typeof ListToolsResponseSchema>;
