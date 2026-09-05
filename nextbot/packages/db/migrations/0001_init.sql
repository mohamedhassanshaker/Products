-- Phase 0/1 initial schema. Hand-authored rather than drizzle-kit-generated (see
-- README in this folder) so it can be reviewed alongside the RLS migration that
-- immediately follows it; the two are conceptually one change per LLD §3.2 rule 1.

CREATE TYPE region AS ENUM ('UAE', 'EU', 'US');
CREATE TYPE environment AS ENUM ('Sandbox', 'Staging', 'Production');
CREATE TYPE tenant_status AS ENUM ('Active', 'Suspended', 'Trial');
CREATE TYPE plan_tier AS ENUM ('Starter', 'Growth', 'Enterprise');

-- tenant (LLD §3.3) — not itself tenant-scoped (it IS the tenant); no RLS predicate applies.
CREATE TABLE tenant (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL,
  region region NOT NULL,
  status tenant_status NOT NULL DEFAULT 'Trial',
  plan_tier plan_tier NOT NULL DEFAULT 'Starter',
  default_language text NOT NULL,
  branding_config jsonb,
  white_label_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_name_key UNIQUE (name),
  CONSTRAINT tenant_slug_key UNIQUE (slug),
  CONSTRAINT tenant_default_language_iso639_1 CHECK (length(default_language) = 2)
);

-- tenant_data_policy (LLD §3.3, FR-ADM-06) — tenant-scoped via its tenant_id PK.
CREATE TABLE tenant_data_policy (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  retention_transcripts_days integer NOT NULL,
  retention_tool_payloads_days integer NOT NULL,
  retention_tool_metadata_days integer NOT NULL,
  retention_pii_days integer NOT NULL,
  residency_region region NOT NULL,
  allow_out_of_region_inference boolean NOT NULL DEFAULT false,
  purge_last_run_at timestamptz,
  CONSTRAINT tenant_data_policy_retention_transcripts_valid CHECK (retention_transcripts_days > 0 OR retention_transcripts_days = -1),
  CONSTRAINT tenant_data_policy_retention_tool_payloads_valid CHECK (retention_tool_payloads_days > 0 OR retention_tool_payloads_days = -1),
  CONSTRAINT tenant_data_policy_retention_tool_metadata_valid CHECK (retention_tool_metadata_days > 0 OR retention_tool_metadata_days = -1),
  CONSTRAINT tenant_data_policy_retention_pii_valid CHECK (retention_pii_days > 0 OR retention_pii_days = -1)
);

-- tenant_runtime_quota (LLD §3.10, NFR-4/NFR-4a/FR-AGT-10) — tenant-scoped via its tenant_id PK.
CREATE TABLE tenant_runtime_quota (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  max_concurrent_runs integer,
  max_tokens_per_minute integer,
  max_tool_calls_per_second integer,
  tool_egress_allowlist text[] NOT NULL DEFAULT '{}',
  max_concurrent_conversations integer,
  max_mcp_connectors integer,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- tenant_database_route (ADR-0001 §2a/§5 escape-hatch routing table) — tenant-scoped via its tenant_id PK.
CREATE TABLE tenant_database_route (
  tenant_id uuid PRIMARY KEY REFERENCES tenant (id),
  is_dedicated boolean NOT NULL DEFAULT false,
  dsn_vault_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- domain_event (LLD §2.4 transactional outbox) — built generically in Phase 0.
CREATE TABLE domain_event (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  processed boolean NOT NULL DEFAULT false,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domain_event_tenant_created_idx ON domain_event (tenant_id, created_at);
CREATE INDEX domain_event_unprocessed_idx ON domain_event (tenant_id, processed);
