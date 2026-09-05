-- Target Architecture Blueprint Phase 14 (BL-46, ADR-0012, LLD §14.7) — Module E:
-- multi-agent orchestration. Three logical parts, all in one file because they are
-- one reviewable unit (LLD's own §14.7.1/§14.7.2 pair):
--
--   A. agent-as-tool: changes to the EXISTING `tool` table (FR-ORC-01). There is
--      deliberately no parallel `agent_tool` table — delegation reuses
--      `tool_permission_rule`, the resolver, the simulate preview, `tool_call`/
--      `tool_call_event` and the Approval Queue verbatim.
--   B. `team` / `team_version` / `team_member` (FR-ORC-03) + the immutability
--      trigger this project applies to every versioned artifact.
--   C. the three real FK constraints on `delegation_event` that Phase 6 (BL-37)
--      had to leave out because their target tables did not exist yet.
--
-- Also: `tool_call.agent_run_id` (FR-ORC-04) so a Tier-3 call made at any
-- delegation depth is joinable back to its run's delegation tree.

-- ===========================================================================
-- A. agent-as-tool (LLD §14.7.1)
-- ===========================================================================

CREATE TYPE tool_kind AS ENUM ('McpTool', 'AgentAsTool');

-- Backfilled trivially by the DEFAULT: every pre-existing row is an McpTool and
-- keeps its exact prior meaning.
ALTER TABLE tool ADD COLUMN kind tool_kind NOT NULL DEFAULT 'McpTool';
ALTER TABLE tool ADD COLUMN agent_definition_version_id uuid
  REFERENCES agent_definition_version (id);

-- The ONLY relaxation of an existing NOT NULL in this area. No data changes: every
-- existing row keeps its connector_id, and the biconditional CHECK immediately
-- below makes "an McpTool always has a connector" a database-enforced invariant
-- rather than merely a column-level one. An AgentAsTool has no connector by
-- construction (there is no MCP server behind a specialist agent).
ALTER TABLE tool ALTER COLUMN connector_id DROP NOT NULL;

ALTER TABLE tool ADD CONSTRAINT tool_kind_agent_version_consistency
  CHECK ((kind = 'AgentAsTool') = (agent_definition_version_id IS NOT NULL));
ALTER TABLE tool ADD CONSTRAINT tool_kind_connector_consistency
  CHECK ((kind = 'McpTool') = (connector_id IS NOT NULL));

CREATE INDEX tool_tenant_kind_agent_version_idx ON tool (tenant_id, kind, agent_definition_version_id);

-- `tool_tenant_connector_name_key` (UNIQUE (tenant_id, connector_id, name)) no
-- longer constrains AgentAsTool rows at all, because Postgres treats NULLs as
-- distinct in a UNIQUE index. Their own uniqueness invariant — one catalog entry per
-- pinned specialist version per tenant — is this partial unique index. Authored here
-- only (drizzle-orm's uniqueIndex builder has no partial-index predicate support),
-- per this codebase's "SQL migrations are the source of truth for what is actually
-- applied" convention.
CREATE UNIQUE INDEX tool_tenant_agent_version_key
  ON tool (tenant_id, agent_definition_version_id)
  WHERE kind = 'AgentAsTool';

-- FR-ORC-04 — see the Drizzle schema's doc comment for why the rendered chain
-- itself is snapshotted into approval_request.risk_summary rather than joined at
-- read time.
ALTER TABLE tool_call ADD COLUMN agent_run_id uuid;

-- ===========================================================================
-- B. team / team_version / team_member (LLD §14.7.2)
-- ===========================================================================

CREATE TYPE team_status AS ENUM ('Active', 'Archived');
CREATE TYPE team_version_status AS ENUM ('Draft', 'EvalGated', 'HumanReview', 'Approved', 'Production', 'Deprecated');
-- FR-ORC-03: Escalate is the default and only currently specified mode
-- ("never silently degrade"). A one-value enum is deliberate.
CREATE TYPE team_failure_mode AS ENUM ('Escalate');
CREATE TYPE team_member_fallback_action AS ENUM ('Member', 'Escalate');

CREATE TABLE team (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,62}$'),
  description text,
  status team_status NOT NULL DEFAULT 'Active',
  current_version_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_tenant_name_key UNIQUE (tenant_id, name)
);
CREATE INDEX team_tenant_status_idx ON team (tenant_id, status);

CREATE TABLE team_version (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  team_id uuid NOT NULL REFERENCES team (id),
  version integer NOT NULL CHECK (version >= 1),
  yaml text NOT NULL,
  yaml_hash text NOT NULL,
  supervisor_definition_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  supervisor_route_version_id uuid NOT NULL REFERENCES model_route_version (id),
  limits_json jsonb NOT NULL,
  -- FR-ORC-03's literal enforcement: NOT NULL with NO DEFAULT. Inserting a team
  -- version without a failure_mode is a constraint violation, not a row that
  -- silently acquires 'Escalate'.
  failure_mode team_failure_mode NOT NULL,
  scope_json jsonb NOT NULL,
  status team_version_status NOT NULL DEFAULT 'Draft',
  eval_suite_id uuid,
  last_eval_run_id uuid,
  -- FR-ORC-11 — required before Approved, and validated (application layer) to be a
  -- run in which delegation_event rows exist for EVERY team_member.
  sandbox_run_id uuid,
  created_by_user_id uuid NOT NULL,
  approved_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_version_tenant_team_version_key UNIQUE (tenant_id, team_id, version),
  CONSTRAINT team_version_approver_distinct
    CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> created_by_user_id)
);
CREATE INDEX team_version_tenant_status_idx ON team_version (tenant_id, status);
CREATE INDEX team_version_tenant_hash_idx ON team_version (tenant_id, yaml_hash);

ALTER TABLE team ADD CONSTRAINT team_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES team_version (id);

CREATE TABLE team_member (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  team_version_id uuid NOT NULL REFERENCES team_version (id),
  definition_version_id uuid NOT NULL REFERENCES agent_definition_version (id),
  tool_id uuid NOT NULL REFERENCES tool (id),
  member_key text NOT NULL CHECK (member_key ~ '^[a-z][a-z0-9_]{1,62}$'),
  delegation_tier approval_tier NOT NULL,
  invoke_when text NOT NULL,
  scope_json jsonb NOT NULL,
  fallback_member_id uuid,
  fallback_action team_member_fallback_action NOT NULL DEFAULT 'Escalate',
  ordinal smallint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT team_member_tenant_version_key_key UNIQUE (tenant_id, team_version_id, member_key),
  CONSTRAINT team_member_fallback_not_self CHECK (fallback_member_id IS DISTINCT FROM id),
  CONSTRAINT team_member_fallback_consistency
    CHECK ((fallback_action = 'Member') = (fallback_member_id IS NOT NULL))
);
CREATE INDEX team_member_tenant_version_ordinal_idx ON team_member (tenant_id, team_version_id, ordinal);
CREATE INDEX team_member_tenant_definition_version_idx ON team_member (tenant_id, definition_version_id);
CREATE INDEX team_member_tenant_tool_idx ON team_member (tenant_id, tool_id);

-- Self-FK added standalone (the table must exist first), same convention every other
-- self/mutual FK in this schema uses. A *cycle* among fallbacks (A -> B -> A) is not
-- expressible as a CHECK and is rejected at save by a real cycle-detection walk
-- (teams/domain/fallback-cycle.ts, TEAM_FALLBACK_CYCLE).
--
-- DEFERRABLE INITIALLY DEFERRED for two real reasons, not as a loosening: (1) a
-- member's fallback may be a later-ordinal member, so one transaction must be able
-- to insert the whole member set in ordinal order and have the pointers resolve at
-- COMMIT; (2) `team_member` rows are immutable (trigger below), so a
-- null-the-pointer-first delete pass — the technique every other FK cycle in this
-- schema uses — is structurally unavailable here. The constraint is still fully
-- enforced, just at COMMIT rather than per statement.
ALTER TABLE team_member ADD CONSTRAINT team_member_fallback_member_id_fkey
  FOREIGN KEY (fallback_member_id) REFERENCES team_member (id)
  DEFERRABLE INITIALLY DEFERRED;

-- Immutability enforcement layer 2 (LLD §14.7.2's "same triple-enforcement pattern
-- as agent_definition_version/skill_version/model_route_version"): a BEFORE UPDATE
-- trigger raising TEAM_VERSION_IMMUTABLE for any column change other than the
-- promotion-ladder bookkeeping columns (`status`, `approved_by_user_id`,
-- `eval_suite_id`, `last_eval_run_id`, `sandbox_run_id`) — the only columns the
-- repository's transition methods ever set. Layer 1: no repository method exposes a
-- generic update. Belt-and-braces: even a hand-written raw SQL UPDATE cannot bypass
-- layer 1.
CREATE OR REPLACE FUNCTION team_version_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.team_id IS DISTINCT FROM OLD.team_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.yaml IS DISTINCT FROM OLD.yaml
     OR NEW.yaml_hash IS DISTINCT FROM OLD.yaml_hash
     OR NEW.supervisor_definition_version_id IS DISTINCT FROM OLD.supervisor_definition_version_id
     OR NEW.supervisor_route_version_id IS DISTINCT FROM OLD.supervisor_route_version_id
     OR NEW.limits_json IS DISTINCT FROM OLD.limits_json
     OR NEW.failure_mode IS DISTINCT FROM OLD.failure_mode
     OR NEW.scope_json IS DISTINCT FROM OLD.scope_json
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'TEAM_VERSION_IMMUTABLE: team_version % cannot be modified once created (only promotion-ladder columns may change)', OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER team_version_immutable_trigger
  BEFORE UPDATE ON team_version
  FOR EACH ROW EXECUTE FUNCTION team_version_immutable();

-- team_member is immutable outright — a member change mints a new team_version.
CREATE OR REPLACE FUNCTION team_member_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'TEAM_MEMBER_IMMUTABLE: team_member % cannot be modified; author a new team_version instead', OLD.id
    USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER team_member_immutable_trigger
  BEFORE UPDATE ON team_member
  FOR EACH ROW EXECUTE FUNCTION team_member_immutable();

-- ===========================================================================
-- C. delegation_event's three deferred FK constraints (LLD §14.7.2)
-- ===========================================================================
-- Phase 6 (BL-37) disclosed these three columns as FK-less purely because
-- team_version/team_member did not exist yet. They exist now, so the constraints
-- become real. `conversation_id`/`escalation_id` stay FK-less, unchanged — those are
-- genuinely optional cross-cutting links, matching pii.guardrail_event's convention.
-- No pre-existing rows can violate these: no live writer for this table has ever
-- existed (Phase 6's own module doc), so the table is empty in every environment.

ALTER TABLE delegation_event ADD CONSTRAINT delegation_event_team_version_id_fkey
  FOREIGN KEY (team_version_id) REFERENCES team_version (id);
ALTER TABLE delegation_event ADD CONSTRAINT delegation_event_from_member_id_fkey
  FOREIGN KEY (from_member_id) REFERENCES team_member (id);
ALTER TABLE delegation_event ADD CONSTRAINT delegation_event_to_member_id_fkey
  FOREIGN KEY (to_member_id) REFERENCES team_member (id);
ALTER TABLE delegation_event ADD CONSTRAINT delegation_event_parent_id_fkey
  FOREIGN KEY (parent_delegation_event_id) REFERENCES delegation_event (id);
ALTER TABLE delegation_event ADD CONSTRAINT delegation_event_fallback_of_event_id_fkey
  FOREIGN KEY (fallback_of_event_id) REFERENCES delegation_event (id);
