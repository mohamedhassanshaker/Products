-- Phase 17 (BL-10): RLS for audit_log_entry (LLD §3.2 rule 1). Append-only-ness
-- (REVOKE UPDATE, DELETE from the app/platform roles) is handled in
-- `ensure-roles.ts`, re-applied on every bootstrap run, not here — see that file's
-- module doc for why a one-time migration-level REVOKE would not be durable
-- against the per-role blanket GRANT loop that runs on every `pnpm db:migrate`.

ALTER TABLE audit_log_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log_entry
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
