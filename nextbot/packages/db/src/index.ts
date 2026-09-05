/**
 * PUBLIC API for @nextbot/db.
 *
 * `withPlatform` is intentionally NOT re-exported here — it lives at the separate
 * `@nextbot/db/platform-only` entry point so dependency-cruiser can restrict its
 * importers to the two call sites LLD §3.2 rule 4 names. See platform-context.ts.
 */
export { withTenant, withGatewayTenant, assertValidTenantContext } from "./tenant-context.js";
export type { TenantContext, TenantScopedClient, Region, Environment } from "./tenant-context.js";
export { TenantContextRequiredError, TenantIsolationViolationError } from "./errors.js";
export { getAppPool, getGatewayPool, getOwnerPool, closeAllPools } from "./pool.js";
export { loadDbEnv, type DbEnv } from "./config.js";
export { generateId } from "./id.js";
export * as schema from "./schema/index.js";
// Phase 2 (BL-33, LLD §14.9.6) — the free-text `ModelRouteChainEntry` shape moved
// with `model_route` to `model-gateway.ts` and was replaced there by the
// catalog-entry-pinned `ModelRouteHop`/`ModelRouteChain` shapes (FR-AGT-21); no
// re-export of that old name remains.
export type { ModelRouteHop, ModelRouteChain, ModelRoutePolicy, ModelCapabilitiesFlags } from "./schema/model-gateway.js";
// Target Architecture Blueprint Phase 10 (BL-41) — the resolved `agent_definition_
// version.knowledge_config` shape (`spec.knowledge` with collection names resolved to
// real ids), reused by `@nextbot/agent-platform`'s save-time resolver and
// `@nextbot/orchestration`'s turn pipeline.
export type { ResolvedAgentKnowledgeConfig } from "./schema/agent-platform.js";
// Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08) — config export needs a
// connector's `stdio_command` shape to faithfully recreate a `StdioViaGateway`-
// transport connector.
export type { StdioCommand } from "./schema/connectors.js";
export type {
  ChunkingConfig,
  KnowledgeTrustLevel,
  KnowledgeAcl,
  KnowledgeSourceLocator,
  KnowledgeSourceFailure,
  ParsedBlock,
  ChunkProvenance,
  PiiMaskEntry,
  IngestionStageProgress,
  SupportedEmbeddingDimension,
  IngestionJobError,
} from "./schema/knowledge.js";
