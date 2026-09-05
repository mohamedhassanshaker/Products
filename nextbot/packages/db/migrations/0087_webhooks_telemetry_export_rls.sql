-- Target Architecture Blueprint Phase 18 (BL-49) — RLS for the four new tenant-scoped
-- tables. Standard single-clause tenant-scoped shape (LLD §3.2 rule 1), identical to
-- every other tenant-scoped table in this codebase.

ALTER TABLE webhook_subscription ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_subscription FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_subscription
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE webhook_delivery ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON webhook_delivery
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE otel_export_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE otel_export_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON otel_export_config
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE siem_export_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE siem_export_config FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON siem_export_config
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
