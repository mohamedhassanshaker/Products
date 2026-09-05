-- Target Architecture Blueprint Phase 20 (BL-52) — RLS for the new tenant-scoped
-- table. Standard single-clause tenant-scoped shape (LLD §3.2 rule 1), identical to
-- every other tenant-scoped table in this codebase.

ALTER TABLE tenant_breakglass_grant ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_breakglass_grant FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_breakglass_grant
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
