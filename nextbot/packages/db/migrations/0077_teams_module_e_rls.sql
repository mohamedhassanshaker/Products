-- Target Architecture Blueprint Phase 14 (BL-46) — RLS for Module E's three new
-- tenant-scoped tables (LLD §3.2 rule 1), identical in shape to every other
-- tenant-scoped table in this codebase (see `0062_teams_delegation_event_rls.sql`).

ALTER TABLE team ENABLE ROW LEVEL SECURITY;
ALTER TABLE team FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE team_version ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_version FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team_version
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE team_member ENABLE ROW LEVEL SECURITY;
ALTER TABLE team_member FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON team_member
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
