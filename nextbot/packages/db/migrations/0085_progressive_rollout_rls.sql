-- Target Architecture Blueprint Phase 17 (BL-48, ADR-0019, LLD §15.2) — RLS for the three
-- new tenant-scoped tables. Standard single-clause tenant-scoped shape (LLD §3.2 rule 1),
-- identical to every other tenant-scoped table in this codebase.
--
-- All three carry their own `tenant_id` column (rather than relying on a join through
-- `deployment`/`shadow_evaluation`) precisely so they can be protected by this same
-- single-clause policy: the resolver's assignment upsert and the pump's
-- `FOR UPDATE SKIP LOCKED` claim must be tenant-isolated by the POLICY itself, not by the
-- statements' own predicates.

ALTER TABLE deployment_traffic_assignment ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_traffic_assignment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deployment_traffic_assignment
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE shadow_evaluation ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_evaluation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shadow_evaluation
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE shadow_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shadow_run
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
