-- Target Architecture Blueprint Phase 2 (BL-33, ADR-0011, LLD §14.8.6 M5, FR-AGT-22)
-- — `agent_definition_version` pins a real `route@version`, not a mutable route-name
-- string. `model_route_key` is RETAINED as a non-authoritative display snapshot (LLD's
-- own instruction) — nothing drops it this phase.

ALTER TABLE agent_definition_version
  ADD COLUMN model_route_version_id uuid REFERENCES model_route_version (id);

-- Backfill: join the version's existing `model_route_key` -> `model_route.name` (post-
-- 0044 rename) -> `current_version_id`, scoped to the same tenant.
UPDATE agent_definition_version av
SET model_route_version_id = mr.current_version_id
FROM model_route mr
WHERE mr.tenant_id = av.tenant_id
  AND mr.name = av.model_route_key
  AND mr.current_version_id IS NOT NULL
  AND av.model_route_version_id IS NULL;

-- Env-default-fallthrough case (LLD §7.1's outer tier): a version whose
-- `model_route_key` matches no `model_route` row for its tenant at all. Synthesize a
-- real route + version 1 pointing at a conservative catalog entry for that env-default
-- so the backfill is total (no row is left unpinned) — mirrors 0044's own synthesis
-- pattern for inline BYO chain entries.
DO $$
DECLARE
  gap_row RECORD;
  new_route_id uuid;
  new_provider_id uuid;
  new_catalog_entry_id uuid;
  new_version_id uuid;
  tenant_region text;
BEGIN
  FOR gap_row IN
    SELECT DISTINCT av.tenant_id, av.model_route_key
    FROM agent_definition_version av
    WHERE av.model_route_version_id IS NULL
  LOOP
    SELECT t.region::text INTO tenant_region FROM tenant t WHERE t.id = gap_row.tenant_id;

    INSERT INTO model_provider (
      id, tenant_id, type, name, region, regions_served, auth_method,
      retains_prompts, trains_on_data, status, health_interval_seconds, enabled
    ) VALUES (
      gen_random_uuid(), gap_row.tenant_id, 'custom', 'Env-default (migrated, route ' || gap_row.model_route_key || ')',
      COALESCE(tenant_region, 'UAE')::region, '{}', 'None', false, false, 'Active', 300, true
    )
    RETURNING id INTO new_provider_id;

    INSERT INTO model_catalog_entry (
      id, provider_id, model_id, display_name, modality, context_window, max_output,
      capabilities_json, tokenizer, price_in, price_out, price_cached, status, source, needs_review
    ) VALUES (
      gen_random_uuid(), new_provider_id, 'env-default', 'Env-default (migrated)', 'Text', 8192, 4096,
      '{"toolCalling":false,"vision":false,"streaming":true,"structuredOutput":false,"extendedThinking":false,"promptCaching":false,"jsonMode":false}'::jsonb,
      'cl100k_base', 0, 0, 0, 'Available', 'Manual', true
    )
    RETURNING id INTO new_catalog_entry_id;

    INSERT INTO model_route (id, tenant_id, name, role, status, created_at, updated_at)
    VALUES (gen_random_uuid(), gap_row.tenant_id, gap_row.model_route_key, 'custom', 'Active', now(), now())
    RETURNING id INTO new_route_id;

    INSERT INTO model_route_version (
      id, tenant_id, route_id, version, chain_json, policy_json,
      advertised_capabilities, strictest_data_handling, max_region_set, status, published_at, created_at
    ) VALUES (
      gen_random_uuid(), gap_row.tenant_id, new_route_id, 1,
      jsonb_build_array(jsonb_build_object(
        'ordinal', 0, 'providerId', new_provider_id, 'catalogEntryId', new_catalog_entry_id,
        'params', '{}'::jsonb, 'timeoutMs', 30000
      )),
      jsonb_build_object(
        'strategy', 'FixedPriority', 'failoverOn', jsonb_build_array('429', '5xx', 'timeout'),
        'retry', jsonb_build_object('maxPerHop', 1, 'backoff', 'exponential'),
        'totalTimeoutMs', 30000, 'cacheMode', 'Off', 'onBudgetBreach', 'Fail', 'allowOutOfRegionFailover', false
      ),
      '{"toolCalling":false,"vision":false,"streaming":true,"structuredOutput":false,"extendedThinking":false,"promptCaching":false,"jsonMode":false}'::jsonb,
      '{"retainsPrompts":false,"trainsOnData":false}'::jsonb,
      COALESCE(ARRAY[tenant_region], '{}'), 'Published', now(), now()
    )
    RETURNING id INTO new_version_id;

    UPDATE model_route SET current_version_id = new_version_id WHERE id = new_route_id;

    UPDATE agent_definition_version
    SET model_route_version_id = new_version_id
    WHERE tenant_id = gap_row.tenant_id AND model_route_key = gap_row.model_route_key;
  END LOOP;
END $$;

ALTER TABLE agent_definition_version ALTER COLUMN model_route_version_id SET NOT NULL;
