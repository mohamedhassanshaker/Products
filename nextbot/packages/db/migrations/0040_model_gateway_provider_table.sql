-- Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8.6 M1, part 2 of 2)
-- — the ALTER-in-place migration of the pre-existing `model_provider` table (platform-
-- level reference data, formerly the 5-value `model_provider_key` enum) into ADR-0011's
-- tenant-registrable Provider Registry shape. No table is renamed or duplicated — same
-- physical table, same rows, extended. Runs after `0039_model_gateway_provider_enum.sql`
-- has committed (a separate transaction), so referencing the new enum values below
-- ('ollama', 'custom', etc., in the CHECK constraint) is safe.

ALTER TABLE model_provider RENAME COLUMN key TO type;
ALTER TABLE model_provider RENAME COLUMN label TO name;
ALTER TABLE model_provider RENAME COLUMN regions TO regions_served;

ALTER TABLE model_provider
  ADD COLUMN tenant_id uuid REFERENCES tenant (id),
  ADD COLUMN region region,
  ADD COLUMN auth_method model_auth_method,
  ADD COLUMN org_or_project_id text,
  ADD COLUMN retains_prompts boolean NOT NULL DEFAULT false,
  ADD COLUMN trains_on_data boolean NOT NULL DEFAULT false,
  ADD COLUMN rate_limit_json jsonb,
  ADD COLUMN status model_provider_status NOT NULL DEFAULT 'Active',
  ADD COLUMN health_interval_seconds integer NOT NULL DEFAULT 300,
  ADD COLUMN last_probe_at timestamptz,
  ADD COLUMN last_probe_error jsonb,
  ADD COLUMN catalog_synced_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill the two new NOT-NULL-eventually columns for any pre-existing row (this
-- phase's seeded data: one 'openai-compatible' provider) before tightening them.
-- `region`: first element of `regions_served` if present, else the platform default
-- region ('UAE', this codebase's NFR-6 default residency region), never left NULL.
UPDATE model_provider
SET region = COALESCE(regions_served[1]::region, 'UAE'::region)
WHERE region IS NULL;

-- `auth_method`: a row that already carries a vaulted `credential_id` was using
-- 'ApiKey' auth in every pre-existing case (`credential_id` was the only auth
-- mechanism this table had); a row with none used no credential at all.
UPDATE model_provider
SET auth_method = CASE WHEN credential_id IS NULL THEN 'None' ELSE 'ApiKey' END::model_auth_method
WHERE auth_method IS NULL;

ALTER TABLE model_provider
  ALTER COLUMN region SET NOT NULL,
  ALTER COLUMN auth_method SET NOT NULL;

-- NOTE (deliberate, flagged deviation from a literal reading of LLD §14.8.2's
-- "base_url ... required (CHECK) for openai-compatible/ollama/custom"): a DB-level
-- CHECK enforcing that is STRICTER than this codebase's actual existing resolution
-- behavior — the pre-existing `agent-platform` Model Gateway v1 path
-- (`resolveModelChainForRoute` / `registerModelProvider`) has always allowed an
-- 'openai-compatible' provider with no `base_url`, falling back to `ai-registry`'s
-- env-configured `AI_BASE_URL` default (LLD §7.1's outer resolution tier) — real,
-- already-shipped, QA-verified behavior this migration must not break. Enforcing the
-- CHECK here would reject that legacy path outright. The new Provider Registry CRUD
-- (`createProviderRegistration`) enforces "self-hosted types need a base URL" at the
-- APPLICATION layer instead (see `@nextbot/model-gateway`'s `provider-service.ts`),
-- which can distinguish "this is the new CRUD path" from "this is the legacy
-- compat path" — a DB CHECK cannot.
ALTER TABLE model_provider
  ADD CONSTRAINT model_provider_credential_required_unless_none
    CHECK (auth_method = 'None' OR credential_id IS NOT NULL),
  ADD CONSTRAINT model_provider_health_interval_range
    CHECK (health_interval_seconds BETWEEN 30 AND 3600);

CREATE INDEX model_provider_tenant_idx ON model_provider (tenant_id);
CREATE INDEX model_provider_type_idx ON model_provider (type);

-- UNIQUE (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'), name) —
-- expressed as an expression unique index since Postgres has no direct
-- "coalesce in a table constraint" shorthand.
CREATE UNIQUE INDEX model_provider_scope_name_key
  ON model_provider (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), name);
