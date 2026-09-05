-- Target Architecture Blueprint Phase 5 (BL-35, ADR-0015, LLD §14.5) — Skills
-- library: `skill` (identity) + `skill_version` (immutable, LLD §14.5.1's three-layer
-- enforcement). Tenant-scoped only (ADR-0015 §2.6, spec §9.5 item 3) — `tenant_id` is
-- NOT NULL on both tables, no exception.

CREATE TYPE skill_status AS ENUM ('Active', 'Archived');
CREATE TYPE skill_version_status AS ENUM ('Draft', 'Published', 'Deprecated');
CREATE TYPE skill_git_pr_status AS ENUM ('None', 'Open', 'Merged', 'Closed');

CREATE TABLE skill (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL CHECK (name ~ '^[a-z][a-z0-9_]{1,62}$'),
  description text,
  status skill_status NOT NULL DEFAULT 'Active',
  current_version_id uuid,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_tenant_name_key UNIQUE (tenant_id, name)
);
CREATE INDEX skill_tenant_status_idx ON skill (tenant_id, status);

CREATE TABLE skill_version (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  skill_id uuid NOT NULL REFERENCES skill (id),
  version smallint NOT NULL,
  yaml text NOT NULL,
  yaml_hash text NOT NULL,
  trigger text NOT NULL,
  scope_capability_group_ids uuid[] NOT NULL DEFAULT '{}',
  scope_tool_ids uuid[] NOT NULL DEFAULT '{}',
  -- Disclosed narrowing of LLD §14.5.2's `scope_knowledge_collection_ids uuid[]` —
  -- see the Drizzle schema's doc comment (packages/db/src/schema/skills.ts):
  -- Knowledge/Graph RAG doesn't exist yet in this codebase, so there is nothing to
  -- resolve a collection name to a real id against this phase. Stores the authored
  -- names verbatim; a future Phase 7 migration adds the real `_ids` column.
  scope_knowledge_collection_names text[] NOT NULL DEFAULT '{}',
  scope_json jsonb NOT NULL,
  instructions text NOT NULL,
  success_criteria text NOT NULL,
  escalate_when jsonb NOT NULL DEFAULT '[]',
  eval_case_ids uuid[] NOT NULL DEFAULT '{}',
  status skill_version_status NOT NULL DEFAULT 'Draft',
  git_commit_sha text,
  git_pr_number integer,
  git_pr_status skill_git_pr_status NOT NULL DEFAULT 'None',
  published_by_user_id uuid,
  published_at timestamptz,
  deprecated_at timestamptz,
  deprecation_note text,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT skill_version_tenant_skill_version_key UNIQUE (tenant_id, skill_id, version)
);
CREATE INDEX skill_version_tenant_status_idx ON skill_version (tenant_id, status);
CREATE INDEX skill_version_tenant_hash_idx ON skill_version (tenant_id, yaml_hash);
CREATE INDEX skill_version_scope_tool_ids_gin_idx ON skill_version USING gin (scope_tool_ids);
CREATE INDEX skill_version_scope_capability_group_ids_gin_idx ON skill_version USING gin (scope_capability_group_ids);
CREATE INDEX skill_version_scope_knowledge_names_gin_idx ON skill_version USING gin (scope_knowledge_collection_names);

ALTER TABLE skill ADD CONSTRAINT skill_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES skill_version (id);

-- LLD §14.5.1 enforcement layer 2: a BEFORE UPDATE trigger raising
-- SKILL_VERSION_IMMUTABLE for any column change other than `status`,
-- `published_by_user_id`, `published_at`, `deprecated_at`, `deprecation_note` — the
-- only columns the repository's `publish`/`deprecate` methods ever set (layer 1: no
-- repository method exposes a generic `update`). This is belt-and-braces: even a
-- hand-written raw SQL UPDATE cannot bypass it.
CREATE OR REPLACE FUNCTION skill_version_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.skill_id IS DISTINCT FROM OLD.skill_id
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.yaml IS DISTINCT FROM OLD.yaml
     OR NEW.yaml_hash IS DISTINCT FROM OLD.yaml_hash
     OR NEW.trigger IS DISTINCT FROM OLD.trigger
     OR NEW.scope_capability_group_ids IS DISTINCT FROM OLD.scope_capability_group_ids
     OR NEW.scope_tool_ids IS DISTINCT FROM OLD.scope_tool_ids
     OR NEW.scope_knowledge_collection_names IS DISTINCT FROM OLD.scope_knowledge_collection_names
     OR NEW.scope_json IS DISTINCT FROM OLD.scope_json
     OR NEW.instructions IS DISTINCT FROM OLD.instructions
     OR NEW.success_criteria IS DISTINCT FROM OLD.success_criteria
     OR NEW.escalate_when IS DISTINCT FROM OLD.escalate_when
     OR NEW.eval_case_ids IS DISTINCT FROM OLD.eval_case_ids
     OR NEW.git_commit_sha IS DISTINCT FROM OLD.git_commit_sha
     OR NEW.git_pr_number IS DISTINCT FROM OLD.git_pr_number
     OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'SKILL_VERSION_IMMUTABLE: skill_version % cannot be modified once created (only status/publish/deprecate columns may change)', OLD.id
      USING ERRCODE = 'raise_exception';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER skill_version_immutable_trigger
  BEFORE UPDATE ON skill_version
  FOR EACH ROW EXECUTE FUNCTION skill_version_immutable();
