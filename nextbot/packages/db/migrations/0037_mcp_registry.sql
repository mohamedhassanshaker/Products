-- Phase 6 (BL-29, ADR-0014, LLD §14.3 — Module A, scoped per this dispatch's own
-- disclosed simplification, see packages/db/src/schema/mcp-registry.ts's doc
-- comment): manifest pinning + drift-as-new-item quarantine. Additive only — no
-- existing table touched.

CREATE TYPE mcp_server_status AS ENUM ('Active', 'Suspended', 'Retired');
CREATE TYPE mcp_server_version_status AS ENUM ('Draft', 'Approved', 'Superseded');
CREATE TYPE mcp_manifest_item_kind AS ENUM ('Tool', 'Resource', 'Prompt');
CREATE TYPE mcp_drift_change_kind AS ENUM ('ItemAdded', 'ItemRemoved', 'SchemaChanged');
CREATE TYPE mcp_drift_resolution AS ENUM ('Pending', 'Accepted', 'Rejected');
CREATE TYPE mcp_reachability AS ENUM ('Unknown', 'Reachable', 'Unreachable');

CREATE TABLE mcp_server (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  name text NOT NULL,
  description text,
  endpoint_url text NOT NULL,
  transport text NOT NULL DEFAULT 'StreamableHTTP',
  credential_id uuid REFERENCES credential (id),
  status mcp_server_status NOT NULL DEFAULT 'Active',
  current_version_id uuid,
  reconcile_interval_seconds integer NOT NULL DEFAULT 3600,
  last_reconciled_at timestamptz,
  reachability mcp_reachability NOT NULL DEFAULT 'Unknown',
  last_probe_error jsonb,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE UNIQUE INDEX mcp_server_tenant_name_key ON mcp_server (tenant_id, name);
CREATE INDEX mcp_server_tenant_status_idx ON mcp_server (tenant_id, status);
CREATE INDEX mcp_server_tenant_last_reconciled_idx ON mcp_server (tenant_id, last_reconciled_at);
ALTER TABLE mcp_server ADD CONSTRAINT mcp_server_reconcile_interval_range
  CHECK (reconcile_interval_seconds BETWEEN 300 AND 86400);

CREATE TABLE mcp_server_version (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  server_id uuid NOT NULL REFERENCES mcp_server (id),
  version integer NOT NULL,
  manifest_hash text NOT NULL,
  item_count integer NOT NULL DEFAULT 0,
  status mcp_server_version_status NOT NULL DEFAULT 'Draft',
  supersedes_version_id uuid REFERENCES mcp_server_version (id),
  approved_by_user_id uuid,
  approved_at timestamptz,
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_server_version_tenant_server_version_key ON mcp_server_version (tenant_id, server_id, version);
CREATE INDEX mcp_server_version_tenant_status_idx ON mcp_server_version (tenant_id, status);
CREATE INDEX mcp_server_version_tenant_hash_idx ON mcp_server_version (tenant_id, manifest_hash);

ALTER TABLE mcp_server ADD CONSTRAINT mcp_server_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES mcp_server_version (id);

CREATE TABLE mcp_manifest_item (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  server_version_id uuid NOT NULL REFERENCES mcp_server_version (id),
  kind mcp_manifest_item_kind NOT NULL,
  name text NOT NULL,
  description_source text NOT NULL,
  schema_json jsonb NOT NULL,
  schema_hash text NOT NULL,
  approval_tier approval_tier NOT NULL DEFAULT 'Tier3',
  enabled boolean NOT NULL DEFAULT false,
  capability_group_id uuid REFERENCES capability_group (id) ON DELETE SET NULL,
  supersedes_item_id uuid REFERENCES mcp_manifest_item (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX mcp_manifest_item_tenant_version_kind_name_key ON mcp_manifest_item (tenant_id, server_version_id, kind, name);
CREATE INDEX mcp_manifest_item_tenant_version_kind_idx ON mcp_manifest_item (tenant_id, server_version_id, kind);
CREATE INDEX mcp_manifest_item_tenant_schema_hash_idx ON mcp_manifest_item (tenant_id, schema_hash);

CREATE TABLE mcp_drift_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  server_id uuid NOT NULL REFERENCES mcp_server (id),
  pinned_version_id uuid NOT NULL REFERENCES mcp_server_version (id),
  detected_at timestamptz NOT NULL DEFAULT now(),
  change_kind mcp_drift_change_kind NOT NULL,
  item_kind mcp_manifest_item_kind NOT NULL,
  item_name text NOT NULL,
  old_schema_hash text,
  new_schema_hash text,
  diff jsonb,
  resolution mcp_drift_resolution NOT NULL DEFAULT 'Pending',
  resolved_by_user_id uuid,
  resolved_at timestamptz,
  resolution_note text,
  resulting_version_id uuid REFERENCES mcp_server_version (id),
  dedupe_key text NOT NULL
);
-- ADR-0014's idempotency guarantee: repeated reconciler runs against unchanged drift
-- insert nothing (ON CONFLICT DO NOTHING against this partial unique index).
CREATE UNIQUE INDEX mcp_drift_event_tenant_dedupe_pending_key ON mcp_drift_event (tenant_id, dedupe_key) WHERE resolution = 'Pending';
CREATE INDEX mcp_drift_event_tenant_server_detected_idx ON mcp_drift_event (tenant_id, server_id, detected_at);
CREATE INDEX mcp_drift_event_tenant_pending_idx ON mcp_drift_event (tenant_id, resolution);
