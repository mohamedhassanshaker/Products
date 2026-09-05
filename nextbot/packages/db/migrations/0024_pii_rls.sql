-- Phase 17 (BL-10): RLS for the four new pii-module tables (LLD §3.2 rule 1).

ALTER TABLE pii_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pii_rule
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE pii_policy ENABLE ROW LEVEL SECURITY;
ALTER TABLE pii_policy FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON pii_policy
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE guardrail_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guardrail_rule
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE data_subject_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_subject_request FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON data_subject_request
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
