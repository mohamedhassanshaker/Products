-- Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13/15, LLD §14.5.5) —
-- the Agent Design Studio's own scratch draft (`studio_draft`, same shape/sweep
-- as `mcp_enrolment_draft`, migration 0052) and the Blueprints Gallery's
-- tenant-local starter templates (`agent_blueprint`, descoped to no cross-tenant
-- sharing per spec §9.5/LLD §14 boundary-with-HLD note, since skill.tenant_id is
-- NOT NULL — no platform-shared skill library exists to compose a shared gallery
-- from either).

CREATE TABLE studio_draft (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  agent_definition_id uuid NOT NULL REFERENCES agent_definition (id),
  step integer NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX studio_draft_tenant_definition_idx ON studio_draft (tenant_id, agent_definition_id);
CREATE INDEX studio_draft_tenant_expires_idx ON studio_draft (tenant_id, expires_at);

CREATE TABLE agent_blueprint (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  description text,
  artifact_yaml text NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX agent_blueprint_tenant_name_key ON agent_blueprint (tenant_id, name);
CREATE INDEX agent_blueprint_tenant_idx ON agent_blueprint (tenant_id);
