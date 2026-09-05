-- Phase 16 (BL-09): escalation queue, routing, live takeover schema (LLD §3.9).

CREATE TYPE escalation_reason AS ENUM ('LowConfidence', 'ToolFailure', 'CustomerRequest', 'SensitiveTopic');
CREATE TYPE escalation_status AS ENUM ('Waiting', 'InProgress', 'Resolved', 'ReturnedToBot');

CREATE TABLE agent_queue (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  queue_external_ref text,
  business_hours jsonb,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX agent_queue_tenant_name_key ON agent_queue (tenant_id, name);
-- Exactly one default queue per tenant (FR-ESC-03's required fallback destination).
CREATE UNIQUE INDEX agent_queue_tenant_default_key ON agent_queue (tenant_id) WHERE is_default;

CREATE TABLE escalation (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  conversation_id uuid NOT NULL REFERENCES conversation (id),
  reason escalation_reason NOT NULL,
  reason_detail jsonb,
  queue_id uuid NOT NULL REFERENCES agent_queue (id),
  matched_routing_rule_id uuid,
  assigned_agent_id uuid REFERENCES app_user (id),
  status escalation_status NOT NULL DEFAULT 'Waiting',
  waiting_since timestamptz NOT NULL DEFAULT now(),
  picked_up_at timestamptz,
  closed_at timestamptz,
  wait_seconds integer,
  ai_context_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX escalation_tenant_conversation_idx ON escalation (tenant_id, conversation_id);
CREATE INDEX escalation_tenant_status_queue_idx ON escalation (tenant_id, status, queue_id);
-- The single most load-bearing constraint this phase adds: at most one non-terminal
-- escalation per conversation, enforced by Postgres itself (not check-then-act) — a
-- concurrent double-trigger (e.g. two turns racing to escalate the same conversation)
-- collides on this index and must be reconciled by the caller, exactly like
-- `tool_call.idempotency_key`'s concurrency pattern from Phase 14.
CREATE UNIQUE INDEX escalation_tenant_conversation_active_key
  ON escalation (tenant_id, conversation_id)
  WHERE status IN ('Waiting', 'InProgress');

CREATE TABLE escalation_routing_rule (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  ordinal integer NOT NULL,
  conditions jsonb NOT NULL,
  queue_id uuid NOT NULL REFERENCES agent_queue (id),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX escalation_routing_rule_tenant_ordinal_idx ON escalation_routing_rule (tenant_id, ordinal);
CREATE UNIQUE INDEX escalation_routing_rule_tenant_ordinal_key ON escalation_routing_rule (tenant_id, ordinal);
