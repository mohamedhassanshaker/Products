-- Phase 6 (BL-30) — RLS for guardrail_event (LLD §3.2 rule 1).

ALTER TABLE guardrail_event ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_event FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON guardrail_event
  USING     (tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);
