ALTER TABLE capability_group ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_group FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON capability_group
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE tool ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tool
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE tool_schema_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_schema_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tool_schema_version
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE tool_permission_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE tool_permission_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tool_permission_rule
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
