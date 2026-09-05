import { Type, type Static } from '@sinclair/typebox';

/** `GET /gpu/nodes` query (FR-GPU-1). */
export const ListGpuNodesQuerySchema = Type.Object({
  role: Type.Optional(Type.Union([Type.Literal('stt'), Type.Literal('tts'), Type.Literal('avatar')])),
  tenant_id: Type.Optional(Type.String()),
});
/** Inferred query. */
export type ListGpuNodesQuery = Static<typeof ListGpuNodesQuerySchema>;

/** One GPU node card (FR-GPU-1/2). `autoscaler` is display-only — v1 has no scale actions. */
export const GpuNodeDtoSchema = Type.Object({
  hostname: Type.String(),
  role: Type.Union([Type.Literal('stt'), Type.Literal('tts'), Type.Literal('avatar')]),
  gpu_util_pct: Type.Number(),
  mem_util_pct: Type.Number(),
  healthy: Type.Boolean(),
  last_heartbeat_at: Type.String(),
  autoscaler: Type.Union([Type.Literal('not_configured'), Type.Literal('external')]),
});
/** Inferred GPU node row. */
export type GpuNodeDto = Static<typeof GpuNodeDtoSchema>;

/** `GET /gpu/nodes` response — empty list is a valid state (FR-GPU-1). */
export const ListGpuNodesResponseSchema = Type.Object({
  items: Type.Array(GpuNodeDtoSchema),
  total: Type.Integer(),
});
/** Inferred response. */
export type ListGpuNodesResponse = Static<typeof ListGpuNodesResponseSchema>;
