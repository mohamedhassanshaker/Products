/** Plain-data projection of an `approved_ai_model` row (controllers never consume the entity
 * directly) — ported verbatim from
 * `legacy/api/src/platform/ai-models/domain/ai-model.types.ts`. */
export interface ApprovedAiModelSummary {
  id: string;
  openRouterModelId: string;
  displayName: string;
  isEnabled: boolean;
  isPlatformDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * `AiModelResolver.resolve()`'s return shape — "the ONLY source of a model id anywhere in the
 * system" once a later phase wires an actual LLM call path against it (Phase 5 per the migration
 * plan's own phase sequence — this dispatch builds the resolver/allowlist data model only, not that
 * consumption wiring). `source` tells the caller (and a future per-tenant read endpoint) whether the
 * tenant has an explicit assignment or is riding the platform default; `fallback` is only present when
 * it differs from `primary`, so a consumer never sees a redundant identical pair.
 */
export interface AiModelSelection {
  source: 'assigned' | 'platform_default';
  primary: { openRouterModelId: string; displayName: string };
  fallback?: { openRouterModelId: string; displayName: string };
}
