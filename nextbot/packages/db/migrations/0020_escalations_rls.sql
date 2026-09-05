-- Phase 16 (BL-09): RLS for the three new tenant-scoped escalation tables (LLD §3.2 rule 1).

ALTER TABLE agent_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_queue FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agent_queue
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE escalation ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalation
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

ALTER TABLE escalation_routing_rule ENABLE ROW LEVEL SECURITY;
ALTER TABLE escalation_routing_rule FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON escalation_routing_rule
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
