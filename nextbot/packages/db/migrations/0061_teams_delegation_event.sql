-- Target Architecture Blueprint Phase 6 (BL-37, ADR-0012, LLD §14.7.2) —
-- `delegation_event` only: the delegation trace-tree's DATA MODEL. See
-- packages/db/src/schema/teams.ts's doc comment for the disclosed FK-less
-- columns (team_version_id/from_member_id/to_member_id — team_version/
-- team_member don't exist as tables yet, Phase 14's scope) and the disclosed
-- non-partitioning (mirrors domain_event's own established precedent). No live
-- writer exists yet — nothing here is reachable by a real running conversation.

CREATE TYPE delegation_outcome AS ENUM (
  'Answered', 'NotMine', 'Escalated', 'Failed', 'Denied', 'BudgetExceeded', 'FallbackUsed', 'Timeout'
);

CREATE TABLE delegation_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  conversation_id uuid,
  agent_run_id uuid NOT NULL,
  team_version_id uuid NOT NULL,
  parent_delegation_event_id uuid,
  parent_span_id text,
  span_id text NOT NULL,
  depth smallint NOT NULL CHECK (depth >= 0 AND depth <= 8),
  sibling_ordinal smallint NOT NULL DEFAULT 0,
  from_agent_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  from_member_id uuid,
  to_agent_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  to_member_id uuid NOT NULL,
  tool_call_id uuid REFERENCES tool_call (id),
  reason text NOT NULL,
  scope_hash text NOT NULL,
  outcome delegation_outcome NOT NULL,
  outcome_detail jsonb,
  fallback_of_event_id uuid,
  tokens_in integer NOT NULL DEFAULT 0,
  tokens_out integer NOT NULL DEFAULT 0,
  cost_usd numeric(18,8) NOT NULL DEFAULT 0,
  latency_ms integer,
  escalation_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- "One indexed scan renders the whole tree" (LLD §14.7.2's own words).
CREATE INDEX delegation_event_tenant_run_depth_idx ON delegation_event (tenant_id, agent_run_id, depth, sibling_ordinal);
CREATE INDEX delegation_event_tenant_conversation_idx ON delegation_event (tenant_id, conversation_id, created_at);
CREATE INDEX delegation_event_tenant_parent_idx ON delegation_event (tenant_id, parent_delegation_event_id);
CREATE INDEX delegation_event_tenant_to_member_idx ON delegation_event (tenant_id, to_member_id, created_at);
CREATE INDEX delegation_event_tenant_escalation_idx ON delegation_event (tenant_id, escalation_id);
