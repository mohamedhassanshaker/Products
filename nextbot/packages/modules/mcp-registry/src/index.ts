// PUBLIC API for "@nextbot/mcp-registry" (Phase 6, BL-29, ADR-0014; Phase 3, BL-34,
// the 9-step enrolment wizard). Everything else in this module is private.

export {
  handleCreateServer,
  handleGetServer,
  handleReconcileServer,
  handleListPendingDrift,
  handleReviewDrift,
  handleListServers,
  handleListServerVersions,
  handleListBindingsForVersion,
  handleMigrateExistingConnectors,
  handleCreateDraft,
  handleGetDraft,
  handleDeleteDraft,
  handleSubmitIdentify,
  handleSubmitTransport,
  handleSubmitAuth,
  handleSubmitDiscover,
  handleSubmitClassify,
  handleSubmitGrouping,
  handleSubmitPolicy,
  handleSubmitDryRun,
  handleSubmitEnrol,
} from "./http/admin-routes.js";
export { reconcileServer, reconcileDueServersForTenant, reconcileDueServersAcrossAllTenants, type ReconcileServerResult } from "./application/reconciler.js";
export { mcpClientManifestFetchPort, type ManifestFetchPort, type LiveManifestTool } from "./application/manifest-fetch-port.js";
export { migrateExistingConnectorsForTenant, migrateExistingConnectorsAcrossAllTenants, type ConnectorMigrationResult } from "./application/connector-migration.js";
export { computeSchemaHash, computeManifestHash, canonicalizeSchema } from "./domain/manifest-hash.js";
export { classifyDrift, computeDriftDedupeKey, type DriftChangeKind } from "./domain/drift-classification.js";
export {
  createServerWithApprovedVersion,
  createServerFromWizard,
  getServer,
  findServerByName,
  listServers,
  listServerVersions,
  // Target Architecture Blueprint Phase 15 (BL-47a, FR-MCP-21) — the null-returning
  // by-id lookup `@nextbot/workflows`' graph validator (V9) uses to resolve a
  // `ToolCall` node's pinned `mcpServerVersionId`.
  findServerVersionById,
  type McpServerVersionRow,
  listBindingsForVersion,
  linkManifestItemToTool,
  getServerVersionManifestHash,
  listManifestItems,
  listManifestItemsFull,
  listServersDueForReconciliation,
  listPendingDriftEvents,
  reviewDrift,
  type McpServerRow,
  type McpManifestItemInput,
  type PendingDriftEventRow,
  type WizardManifestItemInput,
  type WizardBindingInput,
} from "./infrastructure/mcp-server-repository.js";
export type { DraftRow, DraftPayload, DiscoveredItemSnapshot } from "./infrastructure/enrolment-draft-repository.js";
