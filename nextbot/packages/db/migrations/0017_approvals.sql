-- Phase 14 (BL-08): Tier-2/3 approval-tier state machine (LLD §6). `tool_call` is the
-- durable suspension point for a write tool call awaiting customer confirmation
-- (Tier2) or human approval (Tier3); `approval_request` is the Tier-3-specific queue
-- row an admin works from; `tool_call_event` is the append-only transition log (every
-- state change, including rejected duplicate decision attempts, per LLD §6.3's
-- idempotency requirement that a suppressed duplicate is still visible in audit).
--
-- Deliberately narrower than the LLD's literal "every tool call gets a tool_call row"
-- model: Phase 12's already-shipped, already-QA-passed Tier-1 path stays a synchronous
-- call with no persisted row (retrofitting it is a larger, riskier change than this
-- phase's BL-08 mandate) — only Tier-2/3 calls, which structurally require durable
-- suspension across a request/response boundary, get a `tool_call` row this phase.
-- Flagged explicitly in the phase's dev report.

CREATE TYPE tool_call_status AS ENUM (
  'Created', 'PolicyDenied', 'AwaitingCustomerConfirmation', 'AwaitingHumanApproval',
  'Executing', 'Succeeded', 'Failed', 'Cancelled', 'Expired'
);
CREATE TYPE approval_decision AS ENUM ('Approved', 'Rejected', 'MoreInfoRequested');

CREATE TABLE tool_call (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  conversation_id uuid NOT NULL REFERENCES conversation (id),
  tool_id uuid NOT NULL,
  tool_name text NOT NULL,
  connector_id uuid,
  -- Snapshotted at creation time (LLD §6.2 step 6) so a later admin edit to the
  -- tool's configured tier can never retroactively change what a suspended call
  -- resolves to on resume.
  approval_tier approval_tier NOT NULL,
  status tool_call_status NOT NULL DEFAULT 'Created',
  input_args jsonb NOT NULL,
  input_args_masked jsonb,
  -- Server-generated, never derivable/guessable by the client (LLD §6.3 layer 3).
  idempotency_key uuid NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  output jsonb,
  error_message text,
  decision_note text,
  decided_by_user_id uuid,
  decided_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_call_tenant_conversation_idx ON tool_call (tenant_id, conversation_id);
CREATE INDEX tool_call_tenant_status_idx ON tool_call (tenant_id, status);
CREATE UNIQUE INDEX tool_call_tenant_idempotency_key_key ON tool_call (tenant_id, idempotency_key);

-- Tier-3-only queue row (LLD §6.5). One-to-one with the `tool_call` it gates; kept as
-- its own table (rather than folding onto `tool_call`) because it carries fields with
-- no meaning for Tier-2 (risk_summary/followUps, more-info round trips) and is the
-- natural home for the Approval Queue's own filters/sort without widening `tool_call`
-- with Tier-3-only columns every Tier-2 row would carry null.
CREATE TABLE approval_request (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  tool_call_id uuid NOT NULL REFERENCES tool_call (id),
  conversation_id uuid NOT NULL REFERENCES conversation (id),
  requested_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- Denormalized copy of tool_call.status so the queue can filter/sort without a join
  -- for the common case; tool_call remains the single source of truth for the FSM.
  status tool_call_status NOT NULL DEFAULT 'AwaitingHumanApproval',
  risk_summary jsonb NOT NULL DEFAULT '{}',
  more_info_question text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX approval_request_tenant_status_idx ON approval_request (tenant_id, status);
CREATE UNIQUE INDEX approval_request_tenant_tool_call_key ON approval_request (tenant_id, tool_call_id);

-- Append-only transition log — nothing ever updates or deletes a row here (LLD §6.3's
-- "rejected duplicate attempts still logged" requirement; also the recoverable-prior-
-- state mechanism the LLD names for the Tier-2 confirmation card's in-place mutation).
CREATE TABLE tool_call_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  tool_call_id uuid NOT NULL REFERENCES tool_call (id),
  from_status tool_call_status,
  to_status tool_call_status NOT NULL,
  actor_type text NOT NULL, -- 'Customer' | 'HumanAgent' | 'System'
  actor_user_id uuid,
  note text,
  accepted boolean NOT NULL DEFAULT true, -- false = a rejected duplicate/illegal attempt, still logged
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tool_call_event_tenant_tool_call_idx ON tool_call_event (tenant_id, tool_call_id);
