// PUBLIC API for "@nextbot/graph-store" (ADR-0018, LLD §14.4.6).
//
// `ensureTenantGraphDatabase`/`dropTenantGraphDatabase` are intentionally NOT
// re-exported here — they live at the separate `@nextbot/graph-store/provisioning`
// entry point (mirroring `@nextbot/db/platform-only`) so a tenant-data-plane caller
// (which should only ever see the port + `withTenantGraph`) cannot accidentally
// reach for the admin-credentialed provisioning primitive instead.
export type {
  GraphScope,
  GraphNodeRecord,
  GraphEdgeRecord,
  NeighbourhoodRequest,
  NeighbourhoodResult,
  GraphPath,
  GraphStorePort,
} from "./port.js";
export { Neo4jGraphStore } from "./neo4j-graph-store.js";
export { withTenantGraph, withTenantGraphAutoCommit, type GraphTx } from "./tenant-session.js";
export { checkGraphStoreHealth, assertGraphStoreHealthy } from "./health.js";
export { closeAllGraphDrivers } from "./driver.js";
export { loadGraphStoreEnv, _resetGraphStoreEnvCacheForTests, type GraphStoreEnv } from "./config.js";
export {
  GraphStoreInvalidIdentifierError,
  GraphStoreInvalidRequestError,
  GraphStoreForbiddenError,
  GraphStoreUnavailableError,
} from "./errors.js";
export {
  tenantDatabaseName,
  tenantUserName,
  tenantRoleName,
  assertValidGenerationLabel,
  assertValidRelationType,
} from "./naming.js";
