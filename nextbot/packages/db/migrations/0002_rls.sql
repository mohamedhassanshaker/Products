-- RLS enablement for every tenant-scoped table created in 0001_init.sql, per LLD
-- §3.2 rule 1 / ADR-0001. Every tenant-scoped table gets, in the same conceptual
-- change as its creation: ENABLE ROW LEVEL SECURITY, FORCE ROW LEVEL SECURITY, and a
-- USING/WITH CHECK policy comparing tenant_id to the transaction-scoped
-- `app.current_tenant` GUC. `current_setting('app.current_tenant')` (single-arg form,
-- no `missing_ok`) RAISES when the GUC is unset, which is exactly the fail-closed
-- behavior LLD §3.2 rule 4 requires of any query that somehow reaches the DB outside
-- `withTenant()`.
--
-- `packages/db/src/tenant-scoped-tables.ts` is the manifest `rls-coverage.isolation.test.ts`
-- checks against — keep the two in sync.

ALTER TABLE tenant_data_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_data_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_data_policy
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE tenant_runtime_quota ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_runtime_quota FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_runtime_quota
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE tenant_database_route ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_database_route FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_database_route
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE domain_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE domain_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON domain_event
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- Append-only tables have UPDATE/DELETE revoked from the application role once the
-- app role exists (see ensure-roles.ts); domain_event additionally needs an
-- application-role UPDATE for the `processed`/`processed_at` columns via the worker's
-- own narrower grant, added when apps/worker's outbox drain lands (not yet, Phase 0/1).
