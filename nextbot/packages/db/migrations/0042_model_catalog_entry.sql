-- Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8.6 M3) —
-- `model_catalog_entry` (FR-AGT-21): one concrete servable model per provider.
-- `tenant_id` mirrors its provider's, enforced by a trigger (never set independently
-- by application code) — same platform-shared RLS shape as `model_provider`
-- (LLD §14.8.7).

CREATE TYPE model_modality AS ENUM ('Text', 'Vision', 'Audio', 'Embedding', 'Rerank', 'Multimodal');
CREATE TYPE model_catalog_status AS ENUM ('Available', 'Preview', 'Deprecating', 'Retired');
CREATE TYPE model_catalog_source AS ENUM ('Synced', 'Manual');

CREATE TABLE model_catalog_entry (
  id uuid PRIMARY KEY,
  tenant_id uuid REFERENCES tenant (id),
  provider_id uuid NOT NULL REFERENCES model_provider (id),
  model_id text NOT NULL,
  display_name text NOT NULL,
  modality model_modality NOT NULL,
  context_window integer NOT NULL,
  max_output integer NOT NULL,
  dimension smallint,
  capabilities_json jsonb NOT NULL,
  tokenizer text NOT NULL,
  price_in numeric(18, 8) NOT NULL DEFAULT 0,
  price_out numeric(18, 8) NOT NULL DEFAULT 0,
  price_cached numeric(18, 8) NOT NULL DEFAULT 0,
  latency_profile jsonb,
  status model_catalog_status NOT NULL DEFAULT 'Available',
  deprecates_at timestamptz,
  source model_catalog_source NOT NULL,
  synced_at timestamptz,
  -- Transient: true only for rows this migration's own backfill (below) synthesizes.
  -- Dropped once Phase 2's route-version migration lands (LLD §14.8.6 M3/M6).
  needs_review boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX model_catalog_entry_provider_model_key ON model_catalog_entry (provider_id, model_id);
CREATE INDEX model_catalog_entry_provider_status_idx ON model_catalog_entry (provider_id, status);
CREATE INDEX model_catalog_entry_tenant_modality_idx ON model_catalog_entry (tenant_id, modality);
CREATE INDEX model_catalog_entry_deprecating_idx ON model_catalog_entry (status, deprecates_at)
  WHERE status = 'Deprecating';

-- tenant_id ALWAYS mirrors the owning provider's tenant_id — an application-supplied
-- value (including NULL) is silently overwritten, closing off any path where the
-- catalog and its provider could disagree on tenant scope.
CREATE FUNCTION model_catalog_entry_mirror_tenant() RETURNS trigger AS $$
BEGIN
  SELECT tenant_id INTO NEW.tenant_id FROM model_provider WHERE id = NEW.provider_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER model_catalog_entry_mirror_tenant_trigger
  BEFORE INSERT OR UPDATE ON model_catalog_entry
  FOR EACH ROW EXECUTE FUNCTION model_catalog_entry_mirror_tenant();

ALTER TABLE model_catalog_entry ENABLE ROW LEVEL SECURITY;
ALTER TABLE model_catalog_entry FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON model_catalog_entry
  USING      (tenant_id IS NULL OR tenant_id = current_setting('app.current_tenant')::uuid)
  WITH CHECK (tenant_id = current_setting('app.current_tenant')::uuid);

-- Backfill (LLD §14.8.6 M3): for every distinct (providerKey, model) pair found in any
-- tenant's existing `model_route.chain` jsonb, synthesize a conservative catalog entry
-- — all capability flags `false` except `streaming` (so a synthesized entry only ever
-- makes a downstream capability check *stricter*, never looser — fails closed) —
-- flagged `needs_review` for a one-time console banner. A chain entry whose
-- `providerKey` matches no existing `model_provider.type` (a tenant's own inline
-- BYO endpoint, carrying its own `baseUrl`/`credentialId` rather than a registered
-- provider row) has nothing to attach a catalog entry to yet — creating the
-- corresponding tenant-scoped provider row on the fly is Phase 2's job (LLD §14.8.6
-- M4); skipped here, not silently mis-attributed to the wrong provider.
INSERT INTO model_catalog_entry (
  id, provider_id, model_id, display_name, modality, context_window, max_output,
  capabilities_json, tokenizer, price_in, price_out, price_cached, status, source, needs_review
)
SELECT
  gen_random_uuid(),
  matched_provider.id,
  distinct_pairs.model_id,
  distinct_pairs.model_id,
  'Text',
  8192,
  4096,
  '{"toolCalling":false,"vision":false,"streaming":true,"structuredOutput":false,"extendedThinking":false,"promptCaching":false,"jsonMode":false}'::jsonb,
  'cl100k_base',
  0,
  0,
  0,
  'Available',
  'Manual',
  true
FROM (
  SELECT DISTINCT
    mr.tenant_id AS route_tenant_id,
    chain_entry ->> 'providerKey' AS provider_key,
    chain_entry ->> 'model' AS model_id
  FROM model_route mr, jsonb_array_elements(mr.chain) AS chain_entry
  WHERE chain_entry ->> 'providerKey' IS NOT NULL AND chain_entry ->> 'model' IS NOT NULL
) distinct_pairs
JOIN LATERAL (
  SELECT mp.id
  FROM model_provider mp
  WHERE mp.type::text = distinct_pairs.provider_key
    AND (mp.tenant_id = distinct_pairs.route_tenant_id OR mp.tenant_id IS NULL)
  ORDER BY (mp.tenant_id IS NULL) ASC
  LIMIT 1
) matched_provider ON true
ON CONFLICT (provider_id, model_id) DO NOTHING;
