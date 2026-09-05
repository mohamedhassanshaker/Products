-- RLS enablement for 0050's tenant-scoped tables (LLD §3.2 rule 1).

ALTER TABLE sso_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_connection FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sso_connection
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE auth_session ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_session FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON auth_session
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE scim_token ENABLE ROW LEVEL SECURITY;
ALTER TABLE scim_token FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON scim_token
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE api_key ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_key FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON api_key
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
