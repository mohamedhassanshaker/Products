-- Target Architecture Blueprint Phase 1 (BL-32, ADR-0011 §5, LLD §14.8.7) — the
-- platform-shared two-clause RLS policy shape for `model_provider`. This table
-- previously carried no `tenant_id` at all and was therefore RLS-exempt; now that it
-- has a nullable `tenant_id` (platform row = NULL, BYO tenant row = the owning
-- tenant), it needs its own policy shape, distinct from every other
-- `TENANT_SCOPED_TABLES` entry's single-clause `tenant_id = current_setting(...)`:
-- read own rows PLUS every platform row; write own rows only (a tenant can never
-- create/modify/delete a platform-registered provider — `WITH CHECK` rejects
-- `tenant_id IS NULL`). Platform rows are written exclusively via `withPlatform()`
-- (LLD §3.2 rule 4), enforced by the existing `no-platform-outside-allowed-callers`
-- dependency-cruiser rule.

ALTER TABLE model_provider ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_provider FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_provider
  USING      (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
