-- Phase 18 (BL-11): RLS for the two new connectors-module tables (LLD §3.2 rule 1).

ALTER TABLE connector_health_check ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_health_check FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_health_check
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE connector_alert_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_alert_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connector_alert_rule
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
