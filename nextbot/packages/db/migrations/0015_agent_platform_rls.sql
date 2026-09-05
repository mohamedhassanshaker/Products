-- Phase 10 (BL-07): RLS for every tenant-scoped agent-platform table (LLD §3.2 rule 1).
-- `model_provider` is deliberately excluded — platform-level reference data with no
-- `tenant_id` column (see packages/db/src/schema/agent-platform.ts's module doc),
-- same category as `channel_capability`.

ALTER TABLE git_connection ENABLE ROW LEVEL SECURITY;
ALTER TABLE git_connection FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON git_connection
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE agent_definition ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_definition FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_definition
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE agent_definition_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_definition_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_definition_version
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE eval_suite ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_suite FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eval_suite
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE eval_case ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_case FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eval_case
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE eval_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eval_run
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE eval_case_result ENABLE ROW LEVEL SECURITY;
ALTER TABLE eval_case_result FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON eval_case_result
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE deployment ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deployment
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE deployment_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployment_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON deployment_history
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE model_route ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_route FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_route
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE model_budget ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_budget FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_budget
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE model_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_call_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_call_log
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE model_cache_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_cache_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_cache_entry
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE agent_run ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_run FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_run
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
