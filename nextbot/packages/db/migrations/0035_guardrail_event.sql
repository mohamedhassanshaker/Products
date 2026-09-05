-- Phase 6 (BL-30, FR-SEC-09) — append-only audit trail for the new PostToolResult
-- prompt-injection guardrail (a tool-call result screened, and blocked, before it
-- re-enters model context). Additive only: one new table, no existing table touched.

CREATE TABLE guardrail_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  conversation_id uuid,
  tool_call_id uuid,
  kind text NOT NULL,
  applies_at text NOT NULL,
  action text NOT NULL,
  detector text NOT NULL,
  score real,
  matched_excerpt_masked text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guardrail_event_tenant_created_idx ON guardrail_event (tenant_id, created_at);
CREATE INDEX guardrail_event_tenant_kind_created_idx ON guardrail_event (tenant_id, kind, created_at);
