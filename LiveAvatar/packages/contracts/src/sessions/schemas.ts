import { Type, type Static } from '@sinclair/typebox';

/** `GET /sessions` query (FR-SESS-1). */
export const ListSessionsQuerySchema = Type.Object({
  tenant_id: Type.Optional(Type.String()),
  q: Type.Optional(Type.String({ maxLength: 200 })),
  from: Type.Optional(Type.String()),
  to: Type.Optional(Type.String()),
  status: Type.Optional(
    Type.Union([
      Type.Literal('pending'),
      Type.Literal('active'),
      Type.Literal('ended'),
      Type.Literal('failed'),
      Type.Literal('abandoned'),
      Type.Literal('degraded'),
    ]),
  ),
  page: Type.Optional(Type.Integer({ minimum: 1 })),
  page_size: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
});
/** Inferred `GET /sessions` query. */
export type ListSessionsQuery = Static<typeof ListSessionsQuerySchema>;

/** Denormalized provider-stack snapshot as returned on the wire (FR-SESS-1/2). */
export const ProviderStackDtoSchema = Type.Object({
  transport: Type.Union([Type.String(), Type.Null()]),
  stt: Type.Union([Type.String(), Type.Null()]),
  llm: Type.Union([Type.String(), Type.Null()]),
  llm_fallback: Type.Union([Type.String(), Type.Null()]),
  tts: Type.Union([Type.String(), Type.Null()]),
  avatar: Type.Union([Type.String(), Type.Null()]),
});

/** One `GET /sessions` list row. */
export const SessionListItemDtoSchema = Type.Object({
  id: Type.String(),
  tenant_id: Type.String(),
  tenant_slug: Type.String(),
  started_at: Type.String(),
  duration_ms: Type.Union([Type.Integer(), Type.Null()]),
  status: Type.String(),
  provider_stack: ProviderStackDtoSchema,
  error_code: Type.Union([Type.String(), Type.Null()]),
  transcript_purged: Type.Boolean(),
});
/** Inferred session list item. */
export type SessionListItemDto = Static<typeof SessionListItemDtoSchema>;

/** `GET /sessions/{id}` detail response (FR-SESS-2). */
export const SessionDetailDtoSchema = Type.Intersect([
  SessionListItemDtoSchema,
  Type.Object({
    room_name: Type.String(),
    participant_identities: Type.Array(Type.String()),
    recording_present: Type.Boolean(),
    residency_snapshot: Type.Object({
      send_to_remote_llm: Type.String(),
      retain_transcripts_days: Type.Integer(),
      recordings_enabled: Type.Boolean(),
    }),
    summary_status: Type.String(),
  }),
]);
/** Inferred session detail. */
export type SessionDetailDto = Static<typeof SessionDetailDtoSchema>;

/** One row of `GET /sessions/{id}/transcript` (FR-SESS-2). */
export const TranscriptItemDtoSchema = Type.Object({
  seq: Type.Integer(),
  role: Type.Union([Type.Literal('user'), Type.Literal('assistant')]),
  text: Type.Union([Type.String(), Type.Null()]),
  started_at: Type.String(),
  ended_at: Type.Union([Type.String(), Type.Null()]),
});
/** Inferred transcript item. */
export type TranscriptItemDto = Static<typeof TranscriptItemDtoSchema>;

/** One hop's timing within a `GET /sessions/{id}/hops` cycle — missing hops are omitted, never zero-filled (FR-SESS-3). */
export const HopTimingDtoSchema = Type.Object({
  first_partial_ms: Type.Optional(Type.Integer()),
  first_token_ms: Type.Optional(Type.Integer()),
  first_audio_ms: Type.Optional(Type.Integer()),
  first_frame_ms: Type.Optional(Type.Integer()),
  total_ms: Type.Optional(Type.Integer()),
  provider_key: Type.Optional(Type.String()),
  used_fallback: Type.Optional(Type.Boolean()),
  error_code: Type.Optional(Type.String()),
});

/**
 * One graph-node execution within a hop cycle (Phase 9, BL-039 — extends
 * the hop table with node-level session trace rather than a parallel
 * telemetry channel). Unlike `stt`/`llm`/`tts`/`avatar`/`e2e` (at most one
 * row per utterance), a turn can execute many nodes per utterance, so
 * these collect into an array rather than a single optional field.
 */
export const NodeTraceItemDtoSchema = Type.Object({
  node_id: Type.String(),
  node_type: Type.Optional(Type.String()),
  lane: Type.Optional(Type.String()),
  total_ms: Type.Optional(Type.Integer()),
  provider_key: Type.Optional(Type.String()),
  used_fallback: Type.Optional(Type.Boolean()),
  first_token_ms: Type.Optional(Type.Integer()),
  error_code: Type.Optional(Type.String()),
});
export type NodeTraceItemDto = Static<typeof NodeTraceItemDtoSchema>;

/** One utterance cycle's latency breakdown (FR-SESS-3). */
export const HopCycleDtoSchema = Type.Object({
  utterance_seq: Type.Integer(),
  stt: Type.Optional(HopTimingDtoSchema),
  llm: Type.Optional(HopTimingDtoSchema),
  tts: Type.Optional(HopTimingDtoSchema),
  avatar: Type.Optional(HopTimingDtoSchema),
  e2e: Type.Optional(HopTimingDtoSchema),
  /** Phase 9 (BL-039) — one entry per graph node executed this utterance, in execution order. */
  nodes: Type.Array(NodeTraceItemDtoSchema, { default: [] }),
});
/** Inferred hop cycle. */
export type HopCycleDto = Static<typeof HopCycleDtoSchema>;
