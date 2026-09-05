ALTER TABLE credential ENABLE ROW LEVEL SECURITY;
ALTER TABLE credential FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON credential
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE connector ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
