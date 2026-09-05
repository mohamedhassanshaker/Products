-- Target Architecture Blueprint Phase 15 (BL-47a, FR-WF-01/02/04, LLD §14.6.1) —
-- Workflow Designer, authoring half only. `workflow` (identity) + `workflow_version`
-- (immutable, the same triple-enforcement pattern agent_definition_version/
-- skill_version/team_version all use).
--
-- Deliberately does NOT create workflow_run/workflow_run_lease/workflow_run_step or
-- any durable-execution table (LLD §14.6.2/§14.6.4) — that is Phase 16's migration.
-- `workflow_version.sandbox_run_id` is added now, FK-less (no workflow_run table to
-- reference yet — the same relaxation team_version.sandbox_run_id used before
-- delegation_event's FKs could be completed), and stays NULL for every version
-- until Phase 16 populates it — which is what correctly keeps HumanReview ->
-- Approved blocked until then (see @nextbot/workflows' domain/promotion-policy.ts).

CREATE TYPE workflow_status AS ENUM ('Active', 'Archived');
CREATE TYPE workflow_version_status AS ENUM ('Draft', 'EvalGated', 'HumanReview', 'Approved', 'Production', 'Deprecated');
CREATE TYPE workflow_git_pr_status AS ENUM ('None', 'Open', 'Merged', 'Closed');

-- LLD §14.6.3's 12 node kinds. Declared for documentation/future analytics use —
-- no table column stores a bare value of this type this phase (nodes live inside
-- workflow_version.graph_json, not a row-per-node table).
CREATE TYPE workflow_node_kind AS ENUM (
  'Trigger', 'Agent', 'Skill', 'ToolCall', 'Router', 'HumanTask',
  'Parallel', 'Join', 'Loop', 'SubWorkflow', 'Wait', 'End'
);

CREATE TABLE workflow (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,62}$'),
  description text,
  status workflow_status NOT NULL DEFAULT 'Active',
  current_version_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_tenant_name_key UNIQUE (tenant_id, name)
);
CREATE INDEX workflow_tenant_status_idx ON workflow (tenant_id, status);

CREATE TABLE workflow_version (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  workflow_id uuid NOT NULL REFERENCES workflow (id),
  version integer NOT NULL CHECK (version >= 1),
  yaml text NOT NULL,
  yaml_hash text NOT NULL,
  graph_json jsonb NOT NULL,
  scope_json jsonb NOT NULL,
  run_limits jsonb NOT NULL,
  status workflow_version_status NOT NULL DEFAULT 'Draft',
  eval_suite_id uuid,
  last_eval_run_id uuid,
  -- Required non-null before Approved (application layer). FK-less by design —
  -- see this migration's own header note and the Drizzle schema's doc comment.
  sandbox_run_id uuid,
  git_commit_sha text,
  git_pr_number integer,
  git_pr_status workflow_git_pr_status NOT NULL DEFAULT 'None',
  created_by_user_id uuid NOT NULL,
  approved_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workflow_version_tenant_workflow_version_key UNIQUE (tenant_id, workflow_id, version),
  CONSTRAINT workflow_version_approver_distinct
    CHECK (approved_by_user_id IS NULL OR approved_by_user_id <> created_by_user_id)
);
CREATE INDEX workflow_version_tenant_status_idx ON workflow_version (tenant_id, status);
CREATE INDEX workflow_version_tenant_hash_idx ON workflow_version (tenant_id, yaml_hash);

ALTER TABLE workflow ADD CONSTRAINT workflow_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES workflow_version (id);

-- Immutability enforcement layer 2 (LLD §14.6.1's "same triple-enforcement pattern
-- as agent_definition_version/skill_version/team_version"): a BEFORE UPDATE trigger
-- raising WORKFLOW_VERSION_IMMUTABLE for any column change other than the
-- promotion-ladder bookkeeping columns (status, approved_by_user_id, eval_suite_id,
-- last_eval_run_id, sandbox_run_id, git_pr_number, git_pr_status) — the only columns
-- the repository's transition/binding methods ever set. Layer 1: no repository
-- method exposes a generic update. Belt-and-braces: even a hand-written raw SQL
-- UPDATE cannot bypass layer 1.
CREATE OR REPLACE FUNCTION workflow_version_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.yaml IS DISTINCT FROM OLD.yaml
     OR NEW.yaml_hash IS DISTINCT FROM OLD.yaml_hash
     OR NEW.graph_json IS DISTINCT FROM OLD.graph_json
     OR NEW.scope_json IS DISTINCT FROM OLD.scope_json
     OR NEW.run_limits IS DISTINCT FROM OLD.run_limits
     OR NEW.git_commit_sha IS DISTINCT FROM OLD.git_commit_sha
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'WORKFLOW_VERSION_IMMUTABLE: workflow_version % cannot be modified once created (only promotion-ladder columns may change)', OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER workflow_version_immutable_trigger
  BEFORE UPDATE ON workflow_version
  FOR EACH ROW EXECUTE FUNCTION workflow_version_immutable();
