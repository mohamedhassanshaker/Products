-- Phase 6 (BL-03): tool catalog, capability groups, permission rules (LLD §3.6).

CREATE TYPE rw_class AS ENUM ('Read', 'Write');
CREATE TYPE class_source AS ENUM ('AutoHeuristic', 'AdminOverride');
CREATE TYPE approval_tier AS ENUM ('Tier1', 'Tier2', 'Tier3');
CREATE TYPE tier_source AS ENUM ('BackendTypeDefault', 'AdminOverride');
CREATE TYPE tool_status AS ENUM ('Active', 'Disabled', 'Error', 'Removed');
CREATE TYPE rule_scope AS ENUM ('Tool', 'Connector', 'BackendType');
CREATE TYPE permission_effect AS ENUM ('Allow', 'Deny', 'RequireApproval');

CREATE TABLE capability_group (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  guidance_text text,
  priority_weight smallint NOT NULL DEFAULT 50,
  deleted_at timestamptz,
  CONSTRAINT capability_group_tenant_name_key UNIQUE (tenant_id, name)
);

CREATE TABLE tool (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  connector_id uuid NOT NULL REFERENCES connector (id),
  name text NOT NULL,
  display_name text,
  description_source text NOT NULL,
  description_override text,
  current_schema_version_id uuid,
  rw_class rw_class NOT NULL,
  rw_class_source class_source NOT NULL,
  approval_tier approval_tier NOT NULL,
  approval_tier_source tier_source NOT NULL,
  supports_idempotency_key boolean NOT NULL DEFAULT false,
  allow_auto_retry boolean NOT NULL DEFAULT false,
  visible_to_agent boolean NOT NULL DEFAULT true,
  priority_weight smallint NOT NULL DEFAULT 50,
  capability_group_id uuid REFERENCES capability_group (id),
  status tool_status NOT NULL DEFAULT 'Active',
  circuit_state circuit_state NOT NULL DEFAULT 'Closed',
  circuit_opened_at timestamptz,
  circuit_trip_reason text,
  channel_restrictions jsonb,
  rate_limit jsonb,
  last_called_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_tenant_connector_name_key UNIQUE (tenant_id, connector_id, name),
  CONSTRAINT tool_priority_weight_range CHECK (priority_weight BETWEEN 1 AND 100)
);
CREATE INDEX tool_tenant_connector_idx ON tool (tenant_id, connector_id);
CREATE INDEX tool_tenant_visible_status_idx ON tool (tenant_id, visible_to_agent, status);
CREATE INDEX tool_tenant_capability_group_idx ON tool (tenant_id, capability_group_id);
CREATE INDEX tool_tenant_approval_tier_idx ON tool (tenant_id, approval_tier);

CREATE TABLE tool_schema_version (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  tool_id uuid NOT NULL REFERENCES tool (id),
  version_ordinal smallint NOT NULL,
  input_schema jsonb NOT NULL,
  output_schema jsonb NOT NULL,
  schema_hash text NOT NULL,
  breaking_change boolean NOT NULL,
  change_summary jsonb,
  discovered_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_schema_version_tenant_tool_ordinal_key UNIQUE (tenant_id, tool_id, version_ordinal)
);
CREATE INDEX tool_schema_version_tenant_tool_idx ON tool_schema_version (tenant_id, tool_id);

CREATE TABLE tool_permission_rule (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  scope rule_scope NOT NULL,
  tool_id uuid REFERENCES tool (id),
  connector_id uuid REFERENCES connector (id),
  backend_type backend_type,
  ordinal smallint NOT NULL,
  conditions jsonb NOT NULL,
  effect permission_effect NOT NULL,
  required_tier approval_tier,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tool_permission_rule_scope_target_consistency CHECK (
    (scope = 'Tool' AND tool_id IS NOT NULL AND connector_id IS NULL AND backend_type IS NULL)
    OR (scope = 'Connector' AND connector_id IS NOT NULL AND tool_id IS NULL AND backend_type IS NULL)
    OR (scope = 'BackendType' AND backend_type IS NOT NULL AND tool_id IS NULL AND connector_id IS NULL)
  ),
  CONSTRAINT tool_permission_rule_required_tier_only_when_require_approval CHECK (
    (effect = 'RequireApproval' AND required_tier IS NOT NULL) OR (effect != 'RequireApproval' AND required_tier IS NULL)
  )
);
CREATE INDEX tool_permission_rule_tenant_scope_idx ON tool_permission_rule (tenant_id, scope, ordinal);
CREATE INDEX tool_permission_rule_tenant_tool_idx ON tool_permission_rule (tenant_id, tool_id);
CREATE INDEX tool_permission_rule_tenant_connector_idx ON tool_permission_rule (tenant_id, connector_id);

ALTER TABLE tool ADD CONSTRAINT tool_current_schema_version_fk FOREIGN KEY (current_schema_version_id) REFERENCES tool_schema_version (id);
