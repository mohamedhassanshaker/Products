-- Target Architecture Blueprint Phase 16 (BL-47b) — RLS for the durable-execution
-- tables, standard single-clause tenant-scoped shape (LLD §3.2 rule 1), identical to
-- every other tenant-scoped table in this codebase (including `workflow`/
-- `workflow_version` in migration 0080).
--
-- `workflow_run_lease` carries its own `tenant_id` column (rather than relying on a
-- join through `workflow_run`) precisely so it can be protected by this same
-- single-clause policy — the claim statement is a raw `INSERT ... ON CONFLICT` and must
-- be tenant-isolated by the policy itself, not by the query's own predicates.

ALTER TABLE workflow_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_run
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE workflow_run_lease ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_lease FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_run_lease
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE workflow_run_step ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_run_step FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON workflow_run_step
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
