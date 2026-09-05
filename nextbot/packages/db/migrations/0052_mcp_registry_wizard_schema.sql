-- Phase 3 (BL-34, LLD §14.3.1/§14.3.2, docs/plans/mcp-enrolment-wizard-plan.md) — the
-- 9-step MCP enrolment wizard's schema additions on top of Phase 0's already-shipped
-- mcp-registry tables. Additive only: every ALTER TABLE ADD COLUMN below is nullable
-- or DEFAULT-backed so Phase 0's existing rows and its reconciler's existing INSERT
-- statements (unchanged this phase) remain valid without a backfill.

CREATE TYPE mcp_criticality AS ENUM ('Low', 'Medium', 'High', 'BusinessCritical');
CREATE TYPE mcp_binding_reachability AS ENUM ('Unknown', 'Reachable', 'Unreachable');

-- mcp_server (wizard step 1 — identify)
ALTER TABLE mcp_server ADD COLUMN backend_type backend_type;
ALTER TABLE mcp_server ADD COLUMN owner_user_id uuid;
ALTER TABLE mcp_server ADD COLUMN criticality mcp_criticality NOT NULL DEFAULT 'Medium';
ALTER TABLE mcp_server ADD COLUMN trust_level trust_level NOT NULL DEFAULT 'SemiTrusted';

-- mcp_server_version (wizard steps 2/3/7 — transport, auth, runtime policy)
ALTER TABLE mcp_server_version ADD COLUMN transport mcp_transport;
ALTER TABLE mcp_server_version ADD COLUMN auth_method connector_auth_method;
ALTER TABLE mcp_server_version ADD COLUMN policy_json jsonb;

-- mcp_manifest_item (wizard step 5 — classification, step 6's materialised link)
ALTER TABLE mcp_manifest_item ADD COLUMN io_class rw_class NOT NULL DEFAULT 'Write';
ALTER TABLE mcp_manifest_item ADD COLUMN io_class_source class_source NOT NULL DEFAULT 'AutoHeuristic';
ALTER TABLE mcp_manifest_item ADD COLUMN approval_tier_source tier_source NOT NULL DEFAULT 'AdminOverride';
ALTER TABLE mcp_manifest_item ADD COLUMN knowledge_ingestion_candidate boolean NOT NULL DEFAULT false;
ALTER TABLE mcp_manifest_item ADD COLUMN tool_id uuid REFERENCES tool (id);
CREATE INDEX mcp_manifest_item_tenant_tool_idx ON mcp_manifest_item (tenant_id, tool_id);

-- mcp_environment_binding (FR-MCP-19) — one per (server_version, environment), each
-- owning exactly one connector row.
CREATE TABLE mcp_environment_binding (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  server_version_id uuid NOT NULL REFERENCES mcp_server_version (id),
  environment environment NOT NULL,
  endpoint_url text,
  stdio_command jsonb,
  gateway_agent_id uuid,
  credential_id uuid REFERENCES credential (id),
  connector_id uuid NOT NULL REFERENCES connector (id),
  reachability mcp_binding_reachability NOT NULL DEFAULT 'Unknown',
  reachable_at timestamptz,
  last_probe_error jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_environment_binding_tenant_version_env_key ON mcp_environment_binding (tenant_id, server_version_id, environment);
CREATE UNIQUE INDEX mcp_environment_binding_tenant_connector_key ON mcp_environment_binding (tenant_id, connector_id);
CREATE INDEX mcp_environment_binding_tenant_version_idx ON mcp_environment_binding (tenant_id, server_version_id);
CREATE INDEX mcp_environment_binding_tenant_env_reachability_idx ON mcp_environment_binding (tenant_id, environment, reachability);
ALTER TABLE mcp_environment_binding ADD CONSTRAINT mcp_environment_binding_endpoint_url_required_for_http
  CHECK (endpoint_url IS NOT NULL OR stdio_command IS NOT NULL);

-- mcp_enrolment_draft — the wizard's resumable server-side state (§14.3.2).
CREATE TABLE mcp_enrolment_draft (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  server_id uuid REFERENCES mcp_server (id),
  step smallint NOT NULL DEFAULT 1,
  payload jsonb NOT NULL DEFAULT '{}',
  discovery_snapshot jsonb,
  dry_run_result jsonb,
  created_by_user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '7 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_enrolment_draft_tenant_created_by_idx ON mcp_enrolment_draft (tenant_id, created_by_user_id);
CREATE INDEX mcp_enrolment_draft_tenant_expires_idx ON mcp_enrolment_draft (tenant_id, expires_at);
ALTER TABLE mcp_enrolment_draft ADD CONSTRAINT mcp_enrolment_draft_step_range CHECK (step BETWEEN 1 AND 9);
