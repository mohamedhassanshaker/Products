-- Phase 7 (BL-04): RLS for `channel`. `channel_capability` is deliberately excluded
-- — it is static, non-tenant-scoped reference data (LLD §3.4), same category as any
-- other lookup table with no `tenant_id` column.

ALTER TABLE channel ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON channel
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
