-- Target Architecture Blueprint Phase 17 (BL-48, absorbing BL-13's never-built core) —
-- progressive rollout: channel->agent-definition binding, the sticky traffic-split
-- assignment, and shadow evaluation's two work tables.
--
-- Authority: ADR-0019 (§2.2 binding, §2.3 resolver/stickiness, §2.5 shadow) and LLD §15.2.
--
-- NOTHING here touches `deployment`, `deployment_history`, or migration `0016`'s
-- `enforce_deployment_traffic_split_invariant()` trigger: all three are already correct
-- and are DEPENDED UPON by this phase, not modified (ADR-0019 §1's "what is real and
-- load-bearing" list). `deployment_action` needs no new value either — `SplitChange` and
-- `PromoteCanary` have existed in the enum since `0014` and this phase is simply the
-- first code that ever writes them.

-- ---------------------------------------------------------------------------
-- 1. channel -> agent definition (ADR-0019 §2.2)
-- ---------------------------------------------------------------------------

-- `channel.agent_definition_version_id` is DROPPED. It was added by `0010_channels.sql`
-- with an inline "no FK yet — that table doesn't exist until Phase 10" comment that has
-- been stale for many phases, and it is read and written by NOTHING: zero references in
-- `packages/modules/channels`, zero in any live path, zero anywhere outside the Drizzle
-- schema declaration itself (re-verified by repo-wide grep at Phase 17 dispatch time).
-- ADR-0019 §4 records that proof so the removal is not re-litigated later: keeping a
-- vestigial column that LOOKS like it does this job is worse than removing it, because
-- the next reader will assume the binding already works.
ALTER TABLE channel DROP COLUMN IF EXISTS agent_definition_version_id;

-- The real binding: WHICH BOT answers on this channel. The rollout state of that bot
-- (which build serves a given conversation) stays on `deployment`, where the shipped
-- SUM=100 trigger and the emergency-rollback advisory-lock key already live.
-- NULL is a fully supported state, not an error: it falls back to the pre-Phase-17
-- tenant-wide lookup, so no existing tenant, fixture or test regresses.
ALTER TABLE channel ADD COLUMN agent_definition_id uuid REFERENCES agent_definition (id);

CREATE INDEX channel_tenant_agent_definition_idx ON channel (tenant_id, agent_definition_id);

-- Backfill preserving today's behavior EXACTLY: for every tenant that owns exactly one
-- `agent_definition`, bind every one of that tenant's channels to it. A tenant with two
-- or more definitions is genuinely ambiguous and is deliberately left NULL (the legacy
-- "most recently promoted Production version across all definitions" fallback is what
-- those tenants get today anyway, so leaving NULL changes nothing for them).
UPDATE channel c
SET agent_definition_id = sole.agent_definition_id
FROM (
  -- `HAVING count(*) = 1` means the group has exactly one row, so any aggregate picks
  -- that row; `min(id::text)::uuid` is used only because Postgres has no `min(uuid)`.
  SELECT tenant_id, min(id::text)::uuid AS agent_definition_id
  FROM agent_definition
  GROUP BY tenant_id
  HAVING count(*) = 1
) AS sole
WHERE c.tenant_id = sole.tenant_id;

-- ---------------------------------------------------------------------------
-- 2. deployment_traffic_assignment — the sticky binding (ADR-0019 §2.3)
-- ---------------------------------------------------------------------------

-- One row per (tenant, conversation, agent definition): which deployment (and therefore
-- which version) this conversation was assigned to, so a conversation does not flip
-- versions mid-thread when the split changes underneath it.
--
-- LOAD-BEARING, and the most consequential rule in ADR-0019: stickiness is bounded by the
-- ASSIGNED DEPLOYMENT'S OWN `is_active` LIFETIME. The resolver joins `deployment` and
-- requires `is_active`; a stale assignment to a deactivated deployment is DISCARDED and
-- re-resolved, never honored. Promotion, split change, rollback and emergency rollback
-- all deactivate rows, so every one of them takes effect on the NEXT TURN of every
-- in-flight conversation, inside NFR-2's <5s bound. A stickiness that survived
-- deactivation would make emergency rollback silently ineffective for exactly the
-- conversations being harmed by the bad version (ADR-0019 §3's most consequential
-- rejection).
CREATE TABLE deployment_traffic_assignment (
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  -- FK-less BY DESIGN: `agent-platform` owns this table and may not depend on
  -- `conversations` (LLD §14.1's allow-list). This is the same precedent
  -- `agent_run.conversation_id` already sets.
  conversation_id uuid NOT NULL,
  agent_definition_id uuid NOT NULL REFERENCES agent_definition (id),
  deployment_id uuid NOT NULL REFERENCES deployment (id),
  -- Denormalized so the hot per-turn read is one row with no join back to `deployment`
  -- for the answer itself (the join that IS required is the `is_active` lifetime check).
  agent_definition_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, conversation_id, agent_definition_id)
);

CREATE INDEX deployment_traffic_assignment_deployment_idx
  ON deployment_traffic_assignment (tenant_id, deployment_id);

-- ---------------------------------------------------------------------------
-- 3. shadow evaluation (ADR-0019 §2.5, LLD §15.2)
-- ---------------------------------------------------------------------------

CREATE TYPE shadow_evaluation_status AS ENUM ('Active', 'Stopped', 'Completed', 'AutoStopped');
CREATE TYPE shadow_run_status AS ENUM ('Pending', 'Claimed', 'Completed', 'Failed', 'Skipped');
CREATE TYPE shadow_skip_reason AS ENUM ('SourceGone', 'QuotaDeferredTooLong', 'EvaluationStopped');

-- One experiment per (tenant, agent definition, environment) at a time. Off by default
-- (a row only exists once an admin explicitly starts one) and RBAC-gated at the SAME
-- `agent_platform=Write` level as promotion — no new privilege ladder (ADR-0019 §2.6).
CREATE TABLE shadow_evaluation (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  agent_definition_id uuid NOT NULL REFERENCES agent_definition (id),
  environment deploy_environment NOT NULL,
  candidate_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  status shadow_evaluation_status NOT NULL DEFAULT 'Active',
  -- What fraction of real live turns to shadow. Enforced FOR REAL by the enqueue-side
  -- sampling roll, not merely documented — shadow inference is real spend.
  sample_pct smallint NOT NULL CHECK (sample_pct BETWEEN 1 AND 100),
  -- Hard ceilings. Reaching either sets `AutoStopped` (ADR-0019 §2.5's quota/budget
  -- paragraph: the tenant must see the cost, and the experiment must stop itself).
  max_runs integer NOT NULL CHECK (max_runs > 0),
  max_cost_usd numeric(18, 4) NOT NULL CHECK (max_cost_usd > 0),
  runs_enqueued integer NOT NULL DEFAULT 0,
  runs_completed integer NOT NULL DEFAULT 0,
  spend_usd numeric(18, 8) NOT NULL DEFAULT 0,
  stop_reason text,
  created_by_user_id uuid,
  stopped_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  stopped_at timestamptz
);

CREATE UNIQUE INDEX shadow_evaluation_one_active_key
  ON shadow_evaluation (tenant_id, agent_definition_id, environment)
  WHERE status = 'Active';

CREATE INDEX shadow_evaluation_tenant_definition_idx
  ON shadow_evaluation (tenant_id, agent_definition_id);

-- One replay. Stores POINTERS, never a transcript copy (ADR-0019 §2.5 item 2): duplicating
-- customer text into a new table would create a new PII sink needing its own
-- retention-purge and DSR-cascade rules. Pointers create none — and a source conversation
-- purged between enqueue and replay simply terminates the row as `Skipped(SourceGone)`,
-- never an error and never a resurrection of purged content.
CREATE TABLE shadow_run (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  shadow_evaluation_id uuid NOT NULL REFERENCES shadow_evaluation (id),
  -- FK-less, same rationale as `deployment_traffic_assignment.conversation_id` above.
  conversation_id uuid NOT NULL,
  live_agent_run_id uuid NOT NULL REFERENCES agent_run (id),
  -- FK-less: `message` is `conversations`-owned, same allow-list rationale.
  live_message_id uuid NOT NULL,
  candidate_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  -- The candidate's OWN run, once executed. This is deliberately how a shadow trace stays
  -- reachable at all: every ordinary `agent_run` reader excludes
  -- `trigger = 'ShadowEvaluation'`, so the shadow report screen is the only surface that
  -- can reach it, by following this pointer.
  shadow_agent_run_id uuid REFERENCES agent_run (id),
  status shadow_run_status NOT NULL DEFAULT 'Pending',
  skip_reason shadow_skip_reason,
  lease_owner text,
  lease_expires_at timestamptz,
  attempts smallint NOT NULL DEFAULT 0,
  duration_ms integer,
  cost_usd numeric(18, 8),
  tokens_in integer,
  tokens_out integer,
  reply_text text,
  reply_payload_hash text,
  -- LLD §15.2 gives `reply_payload_hash` the stated purpose "hash for cheap divergence
  -- counting". A single hash cannot count divergence on its own — it needs the other side
  -- — so the pump, which reads the live turn's reply anyway while re-reading the
  -- conversation, records the live side's hash and tool-call count here at replay time.
  -- Both are captured ONCE, at replay, rather than recomputed at report time, so the
  -- comparison reflects what the live turn actually did at that moment even if the
  -- conversation is later purged. Neither stores customer text (a hash and a count are
  -- not a transcript copy), so ADR-0019 §2.5's "no new PII sink" property is preserved.
  live_reply_payload_hash text,
  live_tool_call_count smallint,
  -- [{toolName, argsMasked, tier, outcome}] — `outcome` is one of
  -- 'Executed(shadow-noop)' | 'ShadowSuppressed' | 'PolicyDenied'. Args are masked with
  -- the EXISTING `maskArgsForLogging`, never a second masking mechanism.
  would_have_tool_calls jsonb,
  -- Captured as DATA, never acted on: the worker never calls `triggerEscalation`.
  escalation_signal jsonb,
  -- Captured instead of writing `guardrail_event` rows, so the Guardrail analytics screen
  -- is not polluted by traffic no customer ever saw.
  guardrail_outcome jsonb,
  error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- The pump's claim query.
CREATE INDEX shadow_run_tenant_status_created_idx ON shadow_run (tenant_id, status, created_at);
-- The report screen's per-experiment listing.
CREATE INDEX shadow_run_tenant_evaluation_idx ON shadow_run (tenant_id, shadow_evaluation_id);
