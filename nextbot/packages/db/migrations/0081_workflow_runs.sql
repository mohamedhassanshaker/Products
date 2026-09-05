-- Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-05/06/07, LLD §14.6.2) —
-- Workflow Designer, DURABLE EXECUTION half: `workflow_run`, `workflow_run_lease`,
-- `workflow_run_step`.
--
-- Placement authority: ADR-0013 **§7** (amendment, 2026-08-30) and LLD §14.6.2's dated
-- CORRECTION block. The executor is a module in `packages/modules/workflows` hosted
-- in-process by `apps/worker`; `apps/runtime` stays an empty Phase-0 scaffold and there
-- is no queue library. The TABLES below are unchanged from the original LLD §14.6.2
-- text — only the executor's host and the timer mechanism were corrected, which is
-- exactly the property the store-and-lease design exists to give ("no executor state
-- lives in a process", LLD §14 preamble).

CREATE TYPE workflow_run_state AS ENUM (
  'Pending', 'Running', 'Suspended', 'Compensating', 'Succeeded', 'Failed', 'TimedOut', 'Cancelled'
);

-- Deliberately WIDER than `@nextbot/contracts`' `WorkflowRunOutcome` (which is the
-- 4-value AUTHORABLE union an `End` node / `onTimeout` may declare). The extra three —
-- BudgetExceeded, Timeout, Cancelled — are outcomes only the RUNTIME can produce, so no
-- author can express them and no authored node can be mislabelled as one. FR-WF-06's
-- "logged distinctly from a node-level Failed" is exactly this distinction.
CREATE TYPE workflow_run_outcome AS ENUM (
  'Resolved', 'Escalated', 'Transferred', 'Failed', 'BudgetExceeded', 'Timeout', 'Cancelled'
);

CREATE TYPE workflow_trigger_kind AS ENUM (
  'ChannelEvent', 'Webhook', 'Schedule', 'Manual', 'Sandbox', 'SubWorkflow'
);

CREATE TYPE workflow_step_status AS ENUM (
  'Pending', 'Running', 'Suspended', 'Succeeded', 'Failed', 'Skipped', 'Compensated', 'Cancelled'
);

CREATE TYPE suspension_kind AS ENUM ('HumanTask', 'Wait', 'SubWorkflow', 'Approval');

CREATE TYPE workflow_step_ref_kind AS ENUM (
  'AgentVersion', 'SkillVersion', 'Tool', 'WorkflowVersion', 'None'
);

-- ---------------------------------------------------------------------------
-- workflow_run
-- ---------------------------------------------------------------------------

CREATE TABLE workflow_run (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  workflow_version_id uuid NOT NULL REFERENCES workflow_version (id),
  -- NULL for schedule/webhook-triggered runs. A run with no conversation cannot
  -- suspend into the Approval Queue (`tool_call.conversation_id` is NOT NULL) — the
  -- executor surfaces that as a node failure, never as a silent bypass of tiering.
  conversation_id uuid REFERENCES conversation (id),
  -- FK-less, matching `tool_call.agent_run_id`/`delegation_event.agent_run_id`'s
  -- established convention in this codebase for a loosely-associated run id.
  agent_run_id uuid,
  trigger_kind workflow_trigger_kind NOT NULL,
  parent_run_id uuid REFERENCES workflow_run (id),
  depth smallint NOT NULL DEFAULT 0,
  state workflow_run_state NOT NULL DEFAULT 'Pending',
  outcome workflow_run_outcome,
  outcome_detail jsonb,
  -- The frontier: >1 entry while a Parallel branch is open. Denormalized alongside
  -- checkpoint_json.frontier so the pump can index/scan it without parsing JSON.
  current_node_ids text[] NOT NULL DEFAULT '{}',
  -- WorkflowCheckpointSchema — the WHOLE resumable state (LLD §14.6.2).
  checkpoint_json jsonb NOT NULL DEFAULT '{}',
  -- Bumped on every persist; the optimistic-concurrency guard that makes a stale
  -- lease-holder's write fail rather than clobber a newer checkpoint.
  checkpoint_seq integer NOT NULL DEFAULT 0,
  suspension_kind suspension_kind,
  -- 'approval_request:<uuid>' | 'escalation:<uuid>' | 'timer:<iso>' |
  -- 'workflow_run:<uuid>' | 'event:<key>'
  suspension_ref text,
  suspension_expires_at timestamptz,
  suspension_expiry_outcome workflow_run_outcome,
  steps_executed integer NOT NULL DEFAULT 0,
  loop_iterations jsonb NOT NULL DEFAULT '{}',
  cost_usd numeric(18, 8) NOT NULL DEFAULT 0,
  scope_hash text NOT NULL,
  otel_trace_id text NOT NULL,
  -- Trigger-supplied: a redelivered webhook resumes the existing run instead of
  -- starting a second one (LLD §14.6.2).
  idempotency_key text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT workflow_run_tenant_idempotency_key_key UNIQUE (tenant_id, idempotency_key),
  CONSTRAINT workflow_run_depth_bounded CHECK (depth >= 0 AND depth <= 8),
  -- FR-WF-05: "no suspension is indefinite". A Suspended run MUST declare what it is
  -- waiting on, when that wait ends, and what outcome the run takes if it does not.
  -- Enforced as a single biconditional so neither direction can drift: a Suspended run
  -- cannot lack the four fields, and a non-Suspended run cannot retain them.
  CONSTRAINT workflow_run_suspension_consistent CHECK (
    (state = 'Suspended') = (suspension_kind IS NOT NULL)
    AND (state <> 'Suspended' OR (suspension_ref IS NOT NULL
                                  AND suspension_expires_at IS NOT NULL
                                  AND suspension_expiry_outcome IS NOT NULL))
  ),
  -- "NULL until terminal" (LLD §14.6.2) — an outcome on a still-running row would let
  -- a reader believe a run had resolved when it had not.
  CONSTRAINT workflow_run_outcome_terminal_only CHECK (
    outcome IS NULL OR state IN ('Succeeded', 'Failed', 'TimedOut', 'Cancelled')
  ),
  CONSTRAINT workflow_run_ended_at_terminal_only CHECK (
    ended_at IS NULL OR state IN ('Succeeded', 'Failed', 'TimedOut', 'Cancelled')
  ),
  -- A SubWorkflow child is the only kind of run with a parent, and vice versa.
  CONSTRAINT workflow_run_parent_implies_subworkflow CHECK (
    (parent_run_id IS NULL) = (trigger_kind <> 'SubWorkflow')
  )
);

CREATE INDEX workflow_run_tenant_version_started_idx ON workflow_run (tenant_id, workflow_version_id, started_at DESC);
CREATE INDEX workflow_run_tenant_conversation_idx ON workflow_run (tenant_id, conversation_id);
-- The pump's claim scan.
CREATE INDEX workflow_run_claimable_idx ON workflow_run (tenant_id, state) WHERE state IN ('Pending', 'Running');
-- The expiry sweeper's scan.
CREATE INDEX workflow_run_suspension_expiry_idx ON workflow_run (suspension_expires_at) WHERE state = 'Suspended';
CREATE INDEX workflow_run_tenant_parent_idx ON workflow_run (tenant_id, parent_run_id);

-- Phase 15 added `workflow_version.sandbox_run_id` FK-less, with its own migration
-- header noting "no workflow_run table to reference yet". It exists now, and the column
-- is NULL for every row in existence (Phase 15's promotion gate is what kept it so), so
-- adding the real constraint is a non-destructive tightening rather than a migration of
-- existing data.
ALTER TABLE workflow_version
  ADD CONSTRAINT workflow_version_sandbox_run_id_fkey
  FOREIGN KEY (sandbox_run_id) REFERENCES workflow_run (id);

-- ---------------------------------------------------------------------------
-- workflow_run_lease
-- ---------------------------------------------------------------------------
--
-- ADR-0013 §7.2 constraint 3: `apps/worker`'s scheduler has no distributed lock because
-- every job before this one was idempotent and therefore race-tolerant. The workflow
-- executor is the FIRST for which redundant concurrent execution would not be harmless
-- — it advances a state machine with side effects. This table is therefore load-bearing,
-- not optional: the `INSERT ... ON CONFLICT (run_id) DO UPDATE ... WHERE
-- workflow_run_lease.expires_at < now()` claim is what makes exactly-one-advancer true
-- across replicas, and a crashed holder's run becomes reclaimable at TTL.

CREATE TABLE workflow_run_lease (
  run_id uuid PRIMARY KEY REFERENCES workflow_run (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  -- The worker instance id (process-scoped, regenerated per boot).
  owner text NOT NULL,
  acquired_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  -- The run's `checkpoint_seq` at the moment of acquisition. A holder whose run has
  -- advanced past this value under a different owner knows its own view is stale.
  checkpoint_seq_at_acquire integer NOT NULL
);

CREATE INDEX workflow_run_lease_tenant_expiry_idx ON workflow_run_lease (tenant_id, expires_at);

-- ---------------------------------------------------------------------------
-- workflow_run_step (append-only per attempt)
-- ---------------------------------------------------------------------------

CREATE TABLE workflow_run_step (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  run_id uuid NOT NULL REFERENCES workflow_run (id) ON DELETE CASCADE,
  -- The AUTHORED node id from graph_json (e.g. 'issue_refund'), not a row id.
  node_id text NOT NULL,
  node_kind workflow_node_kind NOT NULL,
  attempt smallint NOT NULL DEFAULT 1,
  iteration integer NOT NULL DEFAULT 0,
  branch_key text,
  ref_kind workflow_step_ref_kind NOT NULL,
  ref_version_id uuid,
  -- Snapshot label, survives deletion of the referenced artifact (NFR-10).
  ref_label text,
  status workflow_step_status NOT NULL,
  -- PII-masked before persistence, via @nextbot/pii's EXISTING masker — never a second
  -- masking path (LLD §14.6.2).
  input jsonb,
  output jsonb,
  error jsonb,
  tool_call_id uuid REFERENCES tool_call (id),
  approval_request_id uuid,
  escalation_id uuid,
  child_run_id uuid,
  -- A compensating step is a NEW row pointing at the step it undoes, never an edit of
  -- that step (NFR-10's append-only discipline).
  compensation_of_step_id uuid REFERENCES workflow_run_step (id),
  cost_usd numeric(18, 8) NOT NULL DEFAULT 0,
  trace_span_id text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz,
  CONSTRAINT workflow_run_step_attempt_key UNIQUE (tenant_id, run_id, node_id, iteration, attempt),
  CONSTRAINT workflow_run_step_attempt_positive CHECK (attempt >= 1),
  -- -1 is the COMPENSATION sentinel (FR-WF-04). A compensating step is a new row, never
  -- an edit of the step it undoes (NFR-10), and it must not collide with a retry of the
  -- forward node in `workflow_run_step_attempt_key` above. Giving it a reserved
  -- out-of-band iteration makes that structural: no forward execution can ever produce
  -- -1 (a Loop's iteration index starts at 0 and only increases), so a compensating
  -- step and a forward attempt of the same node can never share a key.
  CONSTRAINT workflow_run_step_iteration_bounded CHECK (iteration >= -1)
);

CREATE INDEX workflow_run_step_tenant_run_started_idx ON workflow_run_step (tenant_id, run_id, started_at);
CREATE INDEX workflow_run_step_tenant_node_status_idx ON workflow_run_step (tenant_id, node_id, status);
CREATE INDEX workflow_run_step_tenant_tool_call_idx ON workflow_run_step (tenant_id, tool_call_id);
