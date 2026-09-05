-- Phase 6 (BL-37) — RLS for `tenant_scope_policy` (LLD §3.2 rule 1).

ALTER TABLE tenant_scope_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_scope_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_scope_policy
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
