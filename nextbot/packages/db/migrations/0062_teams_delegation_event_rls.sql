-- Phase 6 (BL-37) — RLS for `delegation_event` (LLD §3.2 rule 1).

ALTER TABLE delegation_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE delegation_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON delegation_event
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
