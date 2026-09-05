-- Phase 7a — RLS for `tenant_graph_database_route` (LLD §3.2 rule 1), same shape as
-- `tenant_database_route`'s own policy.

ALTER TABLE tenant_graph_database_route ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_graph_database_route FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON tenant_graph_database_route
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
