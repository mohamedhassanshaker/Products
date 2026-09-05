// PUBLIC API for "@nextbot/graph-store/provisioning" — kept at a separate entry
// point (mirroring `@nextbot/db/platform-only`'s pattern) so it can be imported by
// `packages/modules/tenancy` (the one caller LLD/ADR-0018 name for this) without
// pulling tenant-data-plane concerns (`GraphStorePort`, `withTenantGraph`) into a
// module that has no business opening a tenant-scoped session itself.
export {
  ensureTenantGraphDatabase,
  dropTenantGraphDatabase,
  type TenantGraphDatabaseProvisionResult,
} from "./tenant-database-provisioner.js";
