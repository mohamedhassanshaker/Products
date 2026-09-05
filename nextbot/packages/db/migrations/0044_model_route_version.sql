-- Target Architecture Blueprint Phase 2 (BL-33, ADR-0011, LLD §14.8.6 M4, part 2 of 2)
-- — Route v2. `model_route` becomes identity-only; every behavioural field moves onto
-- a new immutable `model_route_version` row. This is a REAL migration on a table that
-- already has production data (the seeded `chat.primary` route) — every existing row
-- is migrated forward into a real version 1, never dropped.

CREATE TABLE model_route_version (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenant (id),
  route_id uuid NOT NULL REFERENCES model_route (id),
  version integer NOT NULL,
  chain_json jsonb NOT NULL,
  policy_json jsonb NOT NULL,
  advertised_capabilities jsonb NOT NULL,
  strictest_data_handling jsonb NOT NULL,
  max_region_set text[] NOT NULL DEFAULT '{}',
  status model_route_version_status NOT NULL DEFAULT 'Draft',
  created_by_user_id uuid,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT model_route_version_tenant_route_version_key UNIQUE (tenant_id, route_id, version)
);
CREATE INDEX model_route_version_tenant_route_idx ON model_route_version (tenant_id, route_id);

-- `model_route` gains its v2 identity-only columns (old behavioural columns stay for
-- now — the backfill below still reads them — and are dropped at the very end of this
-- migration).
ALTER TABLE model_route
  ADD COLUMN role model_route_role NOT NULL DEFAULT 'custom',
  ADD COLUMN current_version_id uuid,
  ADD COLUMN status model_route_status NOT NULL DEFAULT 'Active',
  ADD COLUMN description text;

ALTER TABLE model_route RENAME COLUMN route_key TO name;
ALTER TABLE model_route RENAME CONSTRAINT model_route_tenant_key_key TO model_route_tenant_name_key;

-- `role` defaults to 'custom' above; upgrade any pre-existing row whose `name` exactly
-- matches one of FR-AGT-23's standard route names to the matching role, purely as a
-- metadata convenience (never required — see the enum's own doc comment).
UPDATE model_route SET role = name::model_route_role
WHERE name IN ('chat.primary', 'chat.router', 'embed.default', 'rerank.default', 'vision.default');

ALTER TABLE model_route ADD CONSTRAINT model_route_current_version_id_fkey
  FOREIGN KEY (current_version_id) REFERENCES model_route_version (id);

-- The actual per-row backfill (LLD §14.8.6 M4): for every existing `model_route`,
-- resolve each `chain` entry to a real `model_provider`/`model_catalog_entry`
-- (synthesizing a tenant-owned provider + a conservative catalog entry on the fly for
-- a chain entry that carried its own inline `baseUrl`/`credentialId` rather than
-- referencing a registered provider row — LLD's own instruction), compute the
-- save-time-equivalent `advertised_capabilities` (intersection across hops — the
-- weakest hop wins, FR-AGT-22), `strictest_data_handling` (the strictest/OR'd flag
-- across hops, FR-AGT-25), and `max_region_set` (the union of hop regions), then
-- insert version 1 and point `current_version_id` at it.
DO $$
DECLARE
  route_row RECORD;
  chain_entry jsonb;
  hop_idx integer;
  resolved_provider_id uuid;
  resolved_catalog_entry_id uuid;
  synthesized_provider_type text;
  tenant_region text;
  hops jsonb;
  cap_and jsonb;
  cap_entry jsonb;
  retains boolean;
  trains boolean;
  regions text[];
  provider_region text;
  new_version_id uuid;
  hop_retains boolean;
  hop_trains boolean;
BEGIN
  FOR route_row IN SELECT * FROM model_route LOOP
    hops := '[]'::jsonb;
    cap_and := NULL;
    retains := false;
    trains := false;
    regions := '{}';
    hop_idx := 0;

    SELECT t.region::text INTO tenant_region FROM tenant t WHERE t.id = route_row.tenant_id;

    FOR chain_entry IN SELECT * FROM jsonb_array_elements(COALESCE(route_row.chain, '[]'::jsonb)) LOOP
      resolved_provider_id := NULL;
      resolved_catalog_entry_id := NULL;

      -- Prefer an already-registered provider (tenant's own, else platform-shared) —
      -- the common case, matching 0042's own backfill lateral-join logic.
      SELECT mp.id, mp.region::text INTO resolved_provider_id, provider_region
      FROM model_provider mp
      WHERE mp.type::text = (chain_entry ->> 'providerKey')
        AND (mp.tenant_id = route_row.tenant_id OR mp.tenant_id IS NULL)
      ORDER BY (mp.tenant_id IS NULL) ASC
      LIMIT 1;

      -- No matching registered provider: this chain entry carried its own inline
      -- `baseUrl`/`credentialId` (a tenant's own BYO endpoint, ADR-0006 §2.2) with
      -- nothing to attach a catalog entry to yet — synthesize a real tenant-owned
      -- `model_provider` row for it now, exactly as LLD §14.8.6 M4 instructs.
      IF resolved_provider_id IS NULL THEN
        synthesized_provider_type := CASE
          WHEN (chain_entry ->> 'providerKey') IN (
            'openai','anthropic','gemini','azure-openai','openai-compatible',
            'google-vertex','bedrock','openrouter','ollama','cohere','mistral','custom'
          ) THEN (chain_entry ->> 'providerKey')
          ELSE 'custom'
        END;

        INSERT INTO model_provider (
          id, tenant_id, type, name, base_url, region, regions_served, auth_method,
          credential_id, retains_prompts, trains_on_data, status, health_interval_seconds, enabled
        ) VALUES (
          gen_random_uuid(), route_row.tenant_id, synthesized_provider_type::model_provider_type,
          'Migrated from ' || route_row.name || ' (' || (chain_entry ->> 'providerKey') || ')',
          chain_entry ->> 'baseUrl',
          COALESCE(tenant_region, 'UAE')::region,
          '{}', CASE WHEN (chain_entry ->> 'credentialId') IS NOT NULL THEN 'ApiKey' ELSE 'None' END::model_auth_method,
          (chain_entry ->> 'credentialId')::uuid, false, false, 'Active', 300, true
        )
        RETURNING id, region::text INTO resolved_provider_id, provider_region;
      END IF;

      -- Resolve (or synthesize, same conservative shape as 0042) the catalog entry.
      SELECT mce.id INTO resolved_catalog_entry_id
      FROM model_catalog_entry mce
      WHERE mce.provider_id = resolved_provider_id AND mce.model_id = (chain_entry ->> 'model');

      IF resolved_catalog_entry_id IS NULL THEN
        INSERT INTO model_catalog_entry (
          id, provider_id, model_id, display_name, modality, context_window, max_output,
          capabilities_json, tokenizer, price_in, price_out, price_cached, status, source, needs_review
        ) VALUES (
          gen_random_uuid(), resolved_provider_id, (chain_entry ->> 'model'), (chain_entry ->> 'model'),
          'Text', 8192, 4096,
          '{"toolCalling":false,"vision":false,"streaming":true,"structuredOutput":false,"extendedThinking":false,"promptCaching":false,"jsonMode":false}'::jsonb,
          'cl100k_base', 0, 0, 0, 'Available', 'Manual', true
        )
        ON CONFLICT (provider_id, model_id) DO NOTHING
        RETURNING id INTO resolved_catalog_entry_id;

        IF resolved_catalog_entry_id IS NULL THEN
          SELECT mce.id INTO resolved_catalog_entry_id
          FROM model_catalog_entry mce
          WHERE mce.provider_id = resolved_provider_id AND mce.model_id = (chain_entry ->> 'model');
        END IF;
      END IF;

      SELECT capabilities_json, retains_prompts, trains_on_data INTO cap_entry, hop_retains, hop_trains
      FROM model_catalog_entry mce, model_provider mp
      WHERE mce.id = resolved_catalog_entry_id AND mp.id = resolved_provider_id;
      retains := retains OR hop_retains;
      trains := trains OR hop_trains;

      -- Intersection across hops (AND per flag) — "the weakest hop wins" (FR-AGT-22).
      IF cap_and IS NULL THEN
        cap_and := cap_entry;
      ELSE
        cap_and := jsonb_build_object(
          'toolCalling', (cap_and->>'toolCalling')::boolean AND (cap_entry->>'toolCalling')::boolean,
          'vision', (cap_and->>'vision')::boolean AND (cap_entry->>'vision')::boolean,
          'streaming', (cap_and->>'streaming')::boolean AND (cap_entry->>'streaming')::boolean,
          'structuredOutput', (cap_and->>'structuredOutput')::boolean AND (cap_entry->>'structuredOutput')::boolean,
          'extendedThinking', (cap_and->>'extendedThinking')::boolean AND (cap_entry->>'extendedThinking')::boolean,
          'promptCaching', (cap_and->>'promptCaching')::boolean AND (cap_entry->>'promptCaching')::boolean,
          'jsonMode', (cap_and->>'jsonMode')::boolean AND (cap_entry->>'jsonMode')::boolean
        );
      END IF;

      IF provider_region IS NOT NULL AND NOT (provider_region = ANY(regions)) THEN
        regions := array_append(regions, provider_region);
      END IF;

      hops := hops || jsonb_build_array(jsonb_build_object(
        'ordinal', hop_idx,
        'providerId', resolved_provider_id,
        'catalogEntryId', resolved_catalog_entry_id,
        'params', jsonb_build_object('maxTokens', chain_entry->'maxTokens'),
        'timeoutMs', COALESCE((chain_entry->>'timeoutMs')::integer, route_row.total_timeout_ms, 30000)
      ));

      hop_idx := hop_idx + 1;
    END LOOP;

    -- A route with an empty chain (should not exist in practice — `model_route.chain`
    -- was NOT NULL — but defensively handled) gets an all-false capability set rather
    -- than a NULL, so a downstream `assertRouteSatisfies` check fails closed.
    IF cap_and IS NULL THEN
      cap_and := '{"toolCalling":false,"vision":false,"streaming":false,"structuredOutput":false,"extendedThinking":false,"promptCaching":false,"jsonMode":false}'::jsonb;
    END IF;

    INSERT INTO model_route_version (
      id, tenant_id, route_id, version, chain_json, policy_json,
      advertised_capabilities, strictest_data_handling, max_region_set, status, published_at, created_at
    ) VALUES (
      gen_random_uuid(), route_row.tenant_id, route_row.id, 1, hops,
      jsonb_build_object(
        'strategy', route_row.strategy::text,
        'failoverOn', jsonb_build_array('429', '5xx', 'timeout'),
        'retry', jsonb_build_object('maxPerHop', 1, 'backoff', 'exponential'),
        'totalTimeoutMs', route_row.total_timeout_ms,
        'cacheMode', route_row.cache_mode::text,
        'semanticThreshold', route_row.semantic_threshold::float8,
        'onBudgetBreach', 'Fail',
        'allowOutOfRegionFailover', false
      ),
      cap_and,
      jsonb_build_object('retainsPrompts', retains, 'trainsOnData', trains),
      regions,
      'Published',
      now(),
      route_row.created_at
    )
    RETURNING id INTO new_version_id;

    UPDATE model_route SET current_version_id = new_version_id WHERE id = route_row.id;
  END LOOP;
END $$;

-- Every pre-existing route now has a real, Published version 1 — safe to drop the
-- old behavioural columns and their now-unused enums.
ALTER TABLE model_route
  DROP COLUMN strategy,
  DROP COLUMN chain,
  DROP COLUMN total_timeout_ms,
  DROP COLUMN cache_mode,
  DROP COLUMN semantic_threshold;

DROP TYPE routing_strategy;
DROP TYPE cache_mode;
