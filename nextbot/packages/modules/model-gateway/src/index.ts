// PUBLIC API for "@nextbot/model-gateway" (Target Architecture Blueprint Phase 1,
// BL-32, ADR-0011, LLD §14.8 — provider registry + model catalog only). Everything
// else in this module is private.

export {
  handleCreateProvider,
  handleListProviders,
  handleUpdateProvider,
  handleDeactivateProvider,
  handleProbeProvider,
  handleSyncProviderCatalog,
  handleListCatalog,
  handleDeclareCatalogEntry,
  handleUpdateCatalogEntry,
  handleDeleteCatalogEntry,
  handleProviderSupportsCatalogSync,
} from "./http/admin-routes.js";

export {
  createProviderRegistration,
  listProviderRegistrations,
  updateProviderRegistration,
  deactivateProviderRegistration,
} from "./application/provider-service.js";

export { declareCatalogEntry, listCatalog, updateCatalogEntryDeclaration, removeCatalogEntry } from "./application/catalog-service.js";

export { probeProvider, listProvidersDueForProbe } from "./application/provider-probe-service.js";
export { syncProviderCatalog, listProvidersDueForCatalogSync, type CatalogSyncOutcome } from "./application/catalog-sync-service.js";

export { ADAPTERS, adapterFor, allFalseCapabilities, type ProviderAdapter, type AdapterContext, type CatalogSyncResult, type ProbeResult } from "./domain/adapter-registry.js";

export {
  registerModelProvider,
  listProviders,
  getProvider,
  getProviderByType,
  listOwnProvidersForTenant,
  // Target Architecture Blueprint Phase 7b (BL-38) — knowledge's generation-build
  // step needs a resolved route version's catalog entry (dimension, modality) to
  // stamp `knowledge_index_generation.dimension`/`embedding_catalog_entry_id`.
  getCatalogEntry,
  type ModelProviderRow,
  type ModelCatalogEntryRow,
} from "./infrastructure/model-gateway-repository.js";

/**
 * Scheduled-job entry points for `apps/worker` — every active tenant's own providers,
 * probed/synced per their own cadence. Mirrors the shape of
 * `probeAllConnectorsAcrossAllTenants` (`@nextbot/connectors`) /
 * `reconcileDueServersAcrossAllTenants` (`@nextbot/mcp-registry`).
 */
export { runProviderProbeSweep, runCatalogSyncSweep } from "./application/scheduled-sweeps.js";

// ---------------------------------------------------------------------------
// Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8/§14.9.6) — Route v2,
// capability validation, the gateway call path (moved from `@nextbot/agent-platform`),
// usage/cost.
// ---------------------------------------------------------------------------

export { validateRouteCapabilities, assertRouteSatisfies, type RouteCapabilityContext, type RouteCapabilityResult, type RouteCapabilityHop, type RouteValidationCode } from "./domain/capability-validator.js";

// Target Architecture Blueprint Phase 15 (BL-47a, FR-ORC-03/FR-WF-*, LLD §14.6.3) —
// extracted from `@nextbot/teams`' own inline check so a `Router` workflow node's
// `Classifier` mode can reuse the EXACT SAME "is this route cheap/router-class"
// decision, never a second, independently-derived comparison.
export { isRouterClassRoute, type RouterClassRouteCandidate } from "./domain/router-classification.js";

export {
  createRoute,
  listRoutes,
  getRouteOrThrow,
  listVersionsForRoute,
  createRouteVersion,
  validateRouteVersionDryRun,
  publishRouteVersion,
  getStandardRoutesChecklist,
  getRouteByName,
} from "./application/route-service.js";

export {
  resolveModelChainForRoute,
  resolveModelChainForRouteVersion,
  callModelGatewayText,
  callModelGatewayStructured,
  callModelGatewayStructuredPinned,
  callModelGatewayEmbedding,
  enforceModelBudget,
  type ResolvedRouteChain,
} from "./application/gateway-call-service.js";

export { recordSimulatedUsageEvent, getUsageReport, getCostPerResolvedConversation } from "./application/usage-service.js";

export { resolveOrSynthesizeRouteVersionForKey } from "./application/route-pin-service.js";

export {
  handleCreateRoute,
  handleListRoutes,
  handleGetRoute,
  handleListRouteVersions,
  handleCreateRouteVersion,
  handleValidateRouteVersion,
  handlePublishRouteVersion,
  handleGetStandardRoutes,
  handleGetUsageReport,
  handleGetCostPerResolvedConversation,
} from "./http/route-admin-routes.js";

export {
  type ModelRouteRow,
  type ModelRouteVersionRow,
  insertModelBudget,
  type ModelBudgetRow,
  // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08) — `@nextbot/knowledge`'s
  // collection-save-time residency check needs a resolved route version's own
  // `maxRegionSet` (computed once at publish time by `validateRouteCapabilities`) to
  // confirm the PINNED embedding model's provider(s) actually serve the collection's
  // declared region, not merely that the route resolves at all.
  getRouteVersion,
} from "./infrastructure/route-repository.js";
