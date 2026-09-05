-- Target Architecture Blueprint Phase 5 (BL-35, ADR-0015 §2.6) — RLS for `skill`/
-- `skill_version`, standard single-clause tenant-scoped shape (LLD §3.2 rule 1),
-- same as every other tenant-scoped table in this codebase. No platform-shared
-- exception — skills are ordinary tenant rows, no cross-tenant read path at all.

ALTER TABLE skill ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON skill
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE skill_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON skill_version
  USING      (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
