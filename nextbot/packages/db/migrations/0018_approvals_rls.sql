-- Phase 14 (BL-08): RLS for the three new tenant-scoped approval tables (LLD §3.2 rule 1).

ALTER TABLE tool_call ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_call FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tool_call
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE approval_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_request
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE tool_call_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_call_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tool_call_event
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
