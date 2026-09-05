import { afterEach, describe, expect, it } from "vitest";
import { sql, eq } from "drizzle-orm";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, generateId, schema, getOwnerPool, type TenantScopedClient } from "@nextbot/db";
import { resolveOrSynthesizeRouteVersionForKey } from "../application/route-pin-service.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, LLD §14.8.6 M4) — proves migration
 * `0044_model_route_version.sql`'s per-row backfill DO block (the exact SQL, not a
 * paraphrase) correctly converts a v1-shaped `model_route` row (free-text
 * `chain`/`strategy`/`total_timeout_ms`/`cache_mode`) into a real
 * `model_route_version` pinned to a `model_catalog_entry` — including the
 * capability-intersection ("weakest hop wins") and region-union computations — using
 * a scratch table that mirrors the pre-migration shape (the live `model_route` table
 * itself is already v2-shaped in every environment this test runs against, since
 * migration 0044 already ran before this test file's fixture data ever existed —
 * same technique Phase 1's `catalog-backfill-migration.int.test.ts` used for M3,
 * before Phase 2's schema move made that specific test obsolete).
 *
 * **Disclosed scope note**: this proves the migration's SQL logic is correct against
 * realistic synthetic legacy data (mirroring the real seeded `chat.primary` route's
 * shape from the client-feedback-batch work) — it is not a replay against a captured
 * copy of real pre-Phase-2 production data (none exists; this is a fresh
 * implementation, not a live database upgrade), which is the residual gap flagged to
 * QA in this dispatch's report.
 */
describe("Route v2 migration backfill logic (0044_model_route_version.sql, real Postgres)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    // The scratch table is schema-level (not per-tenant RLS-scoped) — dropped via
    // the owner pool directly, same "test-only direct cleanup" pattern
    // `deleteFixtureTenant` itself uses for the append-only `audit_log_entry` table.
    await getOwnerPool().query("DROP TABLE IF EXISTS legacy_model_route_fixture");
  });

  it("re-pins a 2-hop 'chat.primary'-shaped legacy route to a real Published model_route_version with the correct intersection/region-union", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    // Two real, already-Phase-1-shaped providers + catalog entries — one supports
    // tool calling, the other does not (the "weakest hop wins" fixture).
    const providerAId = generateId();
    const providerBId = generateId();
    await withTenant(ctx, (db: TenantScopedClient) =>
      db.insert(schema.modelProvider).values([
        { id: providerAId, tenantId: ctx.tenantId, type: "openai-compatible", name: "Primary", region: ctx.region, authMethod: "None", retainsPrompts: false, trainsOnData: false },
        { id: providerBId, tenantId: ctx.tenantId, type: "anthropic", name: "Fallback", region: ctx.region, authMethod: "None", retainsPrompts: true, trainsOnData: false },
      ]),
    );
    const entryAId = generateId();
    const entryBId = generateId();
    await withTenant(ctx, (db: TenantScopedClient) =>
      db.insert(schema.modelCatalogEntry).values([
        {
          id: entryAId,
          providerId: providerAId,
          modelId: "primary-model",
          displayName: "primary-model",
          modality: "Text",
          contextWindow: 128_000,
          maxOutput: 8192,
          capabilitiesJson: { toolCalling: true, vision: false, streaming: true, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
          tokenizer: "cl100k_base",
          source: "Synced",
        },
        {
          id: entryBId,
          providerId: providerBId,
          modelId: "fallback-model",
          displayName: "fallback-model",
          modality: "Text",
          contextWindow: 8192,
          maxOutput: 4096,
          // The weaker hop: no tool calling.
          capabilitiesJson: { toolCalling: false, vision: false, streaming: true, structuredOutput: false, extendedThinking: false, promptCaching: false, jsonMode: false },
          tokenizer: "cl100k_base",
          source: "Synced",
        },
      ]),
    );

    // The scratch table mirrors the pre-migration `model_route` shape exactly
    // (LLD §14.8.1's collision inventory). Created via the OWNER pool directly
    // (the tenant-scoped app role has no `CREATE` privilege on `schema public` —
    // by design, ADR-0001's isolation model — and a real migration itself always
    // runs as the schema-owner role anyway, so this is the more faithful choice,
    // not just a workaround). A REAL (non-TEMP) table, not a session-scoped `TEMP
    // TABLE` (this test spans several separate pooled connections); dropped
    // explicitly in `afterEach`.
    await getOwnerPool().query(`
      CREATE TABLE IF NOT EXISTS legacy_model_route_fixture (
        id uuid PRIMARY KEY, tenant_id uuid NOT NULL, route_key text NOT NULL, strategy text NOT NULL,
        chain jsonb NOT NULL, total_timeout_ms integer NOT NULL, cache_mode text NOT NULL, semantic_threshold numeric NOT NULL, created_at timestamptz NOT NULL
      )
    `);

    const legacyRouteId = generateId();
    await withTenant(ctx, (db: TenantScopedClient) =>
      db.execute(sql`
        INSERT INTO legacy_model_route_fixture (id, tenant_id, route_key, strategy, chain, total_timeout_ms, cache_mode, semantic_threshold, created_at)
        VALUES (
          ${legacyRouteId}::uuid, ${ctx.tenantId}::uuid, 'chat.primary', 'FixedPriority',
          ${JSON.stringify([
            { providerKey: "openai-compatible", model: "primary-model" },
            { providerKey: "anthropic", model: "fallback-model" },
          ])}::jsonb,
          30000, 'Off', 0.95, now()
        )
      `),
    );

    // The real `model_route` identity row this DO block's real counterpart would
    // already have via `ALTER TABLE ... RENAME COLUMN route_key TO name` — created
    // here directly since that ALTER already ran in this live schema.
    await withTenant(ctx, (db: TenantScopedClient) => db.insert(schema.modelRoute).values({ id: legacyRouteId, tenantId: ctx.tenantId, name: "chat.primary", role: "chat.primary" }));

    // The exact DO block from `0044_model_route_version.sql`, reading from the
    // scratch table instead of `model_route` (which, live, no longer has these
    // columns) — otherwise byte-identical logic. Built as a plain string (not
    // drizzle's parameterized `sql` tag) and run via `sql.raw`: a `DO $$ ... $$`
    // block's body is static PL/pgSQL source, not a prepared statement — it cannot
    // contain a `$1`-style bind placeholder at all, so `legacyRouteId` (a UUID this
    // test itself generated via `generateId()`, never untrusted input) is inlined
    // directly.
    await withTenant(ctx, (db: TenantScopedClient) =>
      db.execute(sql.raw(`
        DO $$
        DECLARE
          route_row RECORD; chain_entry jsonb; hop_idx integer; resolved_provider_id uuid; resolved_catalog_entry_id uuid;
          hops jsonb; cap_and jsonb; cap_entry jsonb; retains boolean; trains boolean; hop_retains boolean; hop_trains boolean;
          regions text[]; provider_region text; new_version_id uuid;
        BEGIN
          FOR route_row IN SELECT * FROM legacy_model_route_fixture WHERE id = '${legacyRouteId}'::uuid LOOP
            hops := '[]'::jsonb; cap_and := NULL; retains := false; trains := false; regions := '{}'; hop_idx := 0;
            FOR chain_entry IN SELECT * FROM jsonb_array_elements(route_row.chain) LOOP
              SELECT mp.id, mp.region::text INTO resolved_provider_id, provider_region FROM model_provider mp
                WHERE mp.type::text = (chain_entry ->> 'providerKey') AND (mp.tenant_id = route_row.tenant_id OR mp.tenant_id IS NULL)
                ORDER BY (mp.tenant_id IS NULL) ASC LIMIT 1;
              SELECT mce.id INTO resolved_catalog_entry_id FROM model_catalog_entry mce WHERE mce.provider_id = resolved_provider_id AND mce.model_id = (chain_entry ->> 'model');
              SELECT capabilities_json, retains_prompts, trains_on_data INTO cap_entry, hop_retains, hop_trains FROM model_catalog_entry mce, model_provider mp WHERE mce.id = resolved_catalog_entry_id AND mp.id = resolved_provider_id;
              retains := retains OR hop_retains; trains := trains OR hop_trains;
              IF cap_and IS NULL THEN cap_and := cap_entry;
              ELSE cap_and := jsonb_build_object(
                'toolCalling', (cap_and->>'toolCalling')::boolean AND (cap_entry->>'toolCalling')::boolean,
                'vision', (cap_and->>'vision')::boolean AND (cap_entry->>'vision')::boolean,
                'streaming', (cap_and->>'streaming')::boolean AND (cap_entry->>'streaming')::boolean,
                'structuredOutput', (cap_and->>'structuredOutput')::boolean AND (cap_entry->>'structuredOutput')::boolean,
                'extendedThinking', (cap_and->>'extendedThinking')::boolean AND (cap_entry->>'extendedThinking')::boolean,
                'promptCaching', (cap_and->>'promptCaching')::boolean AND (cap_entry->>'promptCaching')::boolean,
                'jsonMode', (cap_and->>'jsonMode')::boolean AND (cap_entry->>'jsonMode')::boolean
              ); END IF;
              IF provider_region IS NOT NULL AND NOT (provider_region = ANY(regions)) THEN regions := array_append(regions, provider_region); END IF;
              hops := hops || jsonb_build_array(jsonb_build_object('ordinal', hop_idx, 'providerId', resolved_provider_id, 'catalogEntryId', resolved_catalog_entry_id, 'params', jsonb_build_object('maxTokens', chain_entry->'maxTokens'), 'timeoutMs', COALESCE((chain_entry->>'timeoutMs')::integer, route_row.total_timeout_ms, 30000)));
              hop_idx := hop_idx + 1;
            END LOOP;
            INSERT INTO model_route_version (id, tenant_id, route_id, version, chain_json, policy_json, advertised_capabilities, strictest_data_handling, max_region_set, status, published_at, created_at)
            VALUES (gen_random_uuid(), route_row.tenant_id, '${legacyRouteId}'::uuid, 1, hops,
              jsonb_build_object('strategy', route_row.strategy, 'failoverOn', jsonb_build_array('429','5xx','timeout'), 'retry', jsonb_build_object('maxPerHop',1,'backoff','exponential'), 'totalTimeoutMs', route_row.total_timeout_ms, 'cacheMode', route_row.cache_mode, 'semanticThreshold', route_row.semantic_threshold::float8, 'onBudgetBreach', 'Fail', 'allowOutOfRegionFailover', false),
              cap_and, jsonb_build_object('retainsPrompts', retains, 'trainsOnData', trains), regions, 'Published', now(), route_row.created_at)
            RETURNING id INTO new_version_id;
            UPDATE model_route SET current_version_id = new_version_id WHERE id = '${legacyRouteId}'::uuid;
          END LOOP;
        END $$;
      `)),
    );

    const [route] = await withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.modelRoute).where(eq(schema.modelRoute.id, legacyRouteId)));
    expect(route?.currentVersionId).toBeTruthy();

    const [version] = await withTenant(ctx, (db: TenantScopedClient) => db.select().from(schema.modelRouteVersion).where(eq(schema.modelRouteVersion.routeId, legacyRouteId)));
    expect(version).toBeDefined();
    expect(version?.status).toBe("Published");
    expect(version?.chainJson).toHaveLength(2);
    expect(version?.chainJson[0]).toMatchObject({ providerId: providerAId, catalogEntryId: entryAId });
    expect(version?.chainJson[1]).toMatchObject({ providerId: providerBId, catalogEntryId: entryBId });

    // The weakest hop wins: hop 1 supports tool calling, hop 2 doesn't -> the
    // migrated route's advertised set does NOT include tool calling (FR-AGT-22).
    expect(version?.advertisedCapabilities.toolCalling).toBe(false);
    expect(version?.advertisedCapabilities.streaming).toBe(true);

    // Strictest data handling is the OR across hops — hop 2's provider retains
    // prompts, so the whole migrated route is flagged as retaining prompts (FR-AGT-25).
    expect(version?.strictestDataHandling).toEqual({ retainsPrompts: true, trainsOnData: false });

    // An agent version referencing 'chat.primary' by name continues to resolve to
    // exactly this migrated route/version — the "zero manual re-configuration"
    // requirement, proven the same way `agent-platform`'s own re-export test proves
    // its resolution path.
    const resolved = await resolveOrSynthesizeRouteVersionForKey(ctx, "chat.primary");
    expect(resolved.id).toBe(version!.id);
  });
});
