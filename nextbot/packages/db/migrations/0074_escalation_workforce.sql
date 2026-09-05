-- Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) —
-- Escalation Workforce Mechanics: assignment/claiming ceiling data, SLA timers,
-- agent presence, CSAT capture. Every new `escalation`/`agent_queue` column is
-- additive with a default/NULL that preserves every pre-existing row's exact prior
-- meaning.

CREATE TYPE agent_presence_state AS ENUM ('Available', 'Busy', 'Away', 'Offline');
CREATE TYPE escalation_assignment_action AS ENUM ('Claimed', 'Released', 'Reassigned', 'AutoAssigned');

ALTER TABLE agent_queue ADD COLUMN sla_seconds integer;

ALTER TABLE escalation ADD COLUMN assigned_at timestamptz;
ALTER TABLE escalation ADD COLUMN sla_due_at timestamptz;
ALTER TABLE escalation ADD COLUMN sla_breached boolean NOT NULL DEFAULT false;
-- Reserved for Phase 14 (BL-46, LLD §14.7.3) — deliberately no FK yet, `delegation_run`
-- doesn't exist as a table until that phase.
ALTER TABLE escalation ADD COLUMN delegation_run_id uuid;
ALTER TABLE escalation ADD COLUMN csat_score smallint;
ALTER TABLE escalation ADD COLUMN csat_comment text;
ALTER TABLE escalation ADD COLUMN csat_captured_at timestamptz;
ALTER TABLE escalation ADD CONSTRAINT escalation_csat_score_range CHECK (csat_score IS NULL OR csat_score BETWEEN 1 AND 5);

CREATE INDEX escalation_tenant_sla_due_idx ON escalation (tenant_id, status, sla_due_at);

CREATE TABLE agent_presence (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  user_id uuid NOT NULL REFERENCES app_user (id),
  state agent_presence_state NOT NULL DEFAULT 'Offline',
  max_concurrent smallint NOT NULL DEFAULT 3,
  current_load smallint NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  CONSTRAINT agent_presence_max_concurrent_nonneg CHECK (max_concurrent >= 0),
  -- Defense-in-depth only: the atomic conditional UPDATE
  -- (`current_load < max_concurrent`) in `agent-presence-repository.ts` is what
  -- actually enforces the ceiling under concurrency; this CHECK cannot itself
  -- (current_load <= max_concurrent isn't enforced here) because an admin lowering
  -- max_concurrent below an already-assigned agent's live load must remain a valid,
  -- allowed action — it just blocks *new* assignments until load drains naturally.
  CONSTRAINT agent_presence_current_load_nonneg CHECK (current_load >= 0)
);

CREATE INDEX agent_presence_tenant_idx ON agent_presence (tenant_id);

CREATE TABLE escalation_assignment_log (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  escalation_id uuid NOT NULL REFERENCES escalation (id),
  user_id uuid NOT NULL REFERENCES app_user (id),
  action escalation_assignment_action NOT NULL,
  actor_user_id uuid REFERENCES app_user (id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX escalation_assignment_log_tenant_escalation_idx ON escalation_assignment_log (tenant_id, escalation_id);
CREATE INDEX escalation_assignment_log_tenant_user_idx ON escalation_assignment_log (tenant_id, user_id);
