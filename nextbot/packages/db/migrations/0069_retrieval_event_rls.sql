-- Target Architecture Blueprint Phase 10 (BL-41) — RLS for `retrieval_event`
-- (LLD §3.2 rule 1), same shape every other tenant-scoped table in this codebase uses.

ALTER TABLE retrieval_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE retrieval_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON retrieval_event
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
