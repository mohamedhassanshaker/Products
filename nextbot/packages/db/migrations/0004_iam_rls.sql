-- RLS enablement for 0003_iam.sql's tenant-scoped tables (LLD §3.2 rule 1).

ALTER TABLE app_user ENABLE ROW LEVEL SECURITY;
ALTER TABLE app_user FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON app_user
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE role ENABLE ROW LEVEL SECURITY;
ALTER TABLE role FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON role
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE user_role ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_role FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON user_role
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE sso_group_mapping ENABLE ROW LEVEL SECURITY;
ALTER TABLE sso_group_mapping FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON sso_group_mapping
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE login_lockout_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_lockout_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON login_lockout_policy
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE mfa_secret ENABLE ROW LEVEL SECURITY;
ALTER TABLE mfa_secret FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON mfa_secret
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- login_attempt: tenant_id is nullable (an attempt against an unresolvable email has
-- no tenant to scope to yet — see packages/db/src/schema/iam.ts). The policy admits
-- a row when it matches the caller's tenant OR has no tenant at all; every read this
-- module performs still filters explicitly by tenant_id (defense in depth, LLD §3.2
-- rule 4's "RLS is the backstop, not the query planner's only hint"), and every write
-- for an unresolved email goes through withPlatform (the row literally cannot be
-- scoped to a SET LOCAL tenant that doesn't exist yet for that request).
ALTER TABLE login_attempt ENABLE ROW LEVEL SECURITY;
ALTER TABLE login_attempt FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON login_attempt
  USING     (tenant_id = current_setting('app.current_tenant')::uuid OR tenant_id IS NULL)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid OR tenant_id IS NULL);
