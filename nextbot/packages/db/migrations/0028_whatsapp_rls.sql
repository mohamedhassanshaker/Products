-- Phase 3 (BL-15): RLS for the five new tenant-scoped WhatsApp/Meta tables (LLD §3.2 rule 1).

ALTER TABLE meta_business_account ENABLE ROW LEVEL SECURITY;
ALTER TABLE meta_business_account FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON meta_business_account
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE whatsapp_number ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_number FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_number
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE whatsapp_template ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_template FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON whatsapp_template
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE consent_record ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_record FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_record
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE consent_import_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE consent_import_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_import_log
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
