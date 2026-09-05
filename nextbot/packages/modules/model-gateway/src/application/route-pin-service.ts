import type { TenantContext } from "@nextbot/db";
import type { ModelRouteRoleValue } from "@nextbot/contracts";
import { getRouteByName, getRouteVersion, type ModelRouteVersionRow } from "../infrastructure/route-repository.js";
import { createProvider, createCatalogEntry } from "../infrastructure/model-gateway-repository.js";
import { createRoute, createRouteVersion } from "./route-service.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, LLD §7.1's "env default" resolution
 * tier, FR-AGT-22) — resolves an agent version's `modelRouteKey` (a route NAME, e.g.
 * `chat.primary`) to a real, persisted `model_route_version` for the immutable
 * `agent_definition_version.model_route_version_id` pin. If a route by that name
 * already exists, its current (Published) version is returned unchanged. If NOT —
 * the same situation migration `0045_agent_version_route_pin.sql` handled for
 * historical data — a conservative fallback route + version is synthesized on the
 * fly here (a tenant-owned `custom` provider in the tenant's own region, an
 * all-false-except-streaming catalog entry, a single-hop chain), mirroring that
 * migration's own logic exactly so "no route configured yet" behaves identically at
 * runtime to how it was backfilled historically. This is what keeps `chat.primary`
 * (and every other logical route name a test/tenant references before ever visiting
 * the Model Gateway console) resolvable without forcing every version-create call
 * site to pre-configure a route first.
 */
export async function resolveOrSynthesizeRouteVersionForKey(
  ctx: TenantContext,
  routeKey: string,
): Promise<ModelRouteVersionRow> {
  const existingRoute = await getRouteByName(ctx, routeKey);
  if (existingRoute?.currentVersionId) {
    const version = await getRouteVersion(ctx, existingRoute.currentVersionId);
    if (version) return version;
  }

  const provider = await createProvider(ctx, {
    type: "custom",
    name: `Env-default (auto, route ${routeKey})`,
    region: ctx.region,
    authMethod: "None",
    retainsPrompts: false,
    trainsOnData: false,
    enabled: true,
  });
  // NOTE (deliberate, disclosed difference from migration `0045`'s synthesis): that
  // migration backfills for REAL, already-running historical data with unknown
  // actual capabilities, so it must fail closed (all-false except streaming). This
  // is the opposite situation — a brand-new agent version whose author simply
  // hasn't visited the Model Gateway console to configure a real route YET — and a
  // maximally conservative placeholder would spuriously block ordinary tool-calling
  // agents from ever being created before their first console visit. Assumes the
  // common-case capability set instead; whatever real route the tenant configures
  // later fully supersedes this placeholder (`createAgentDefinitionVersion` re-pins
  // to the real route the NEXT time this exact `routeKey` resolves to one).
  const entry = await createCatalogEntry(ctx, {
    providerId: provider.id,
    modelId: "env-default",
    displayName: "Env-default (auto)",
    modality: "Text",
    contextWindow: 8192,
    maxOutput: 4096,
    capabilitiesJson: { toolCalling: true, vision: false, streaming: true, structuredOutput: true, extendedThinking: false, promptCaching: false, jsonMode: true },
    tokenizer: "cl100k_base",
    source: "Manual",
  });

  const standardRoleNames: readonly string[] = ["chat.primary", "chat.router", "embed.default", "rerank.default", "vision.default"];
  const role: ModelRouteRoleValue = standardRoleNames.includes(routeKey) ? (routeKey as ModelRouteRoleValue) : "custom";
  const route = existingRoute ?? (await createRoute(ctx, { name: routeKey, role }));

  return createRouteVersion(
    ctx,
    route.id,
    {
      chain: [{ ordinal: 0, providerId: provider.id, catalogEntryId: entry.id, params: {}, timeoutMs: 30000 }],
      policy: {
        strategy: "FixedPriority",
        failoverOn: ["429", "5xx", "timeout"],
        retry: { maxPerHop: 1, backoff: "exponential" },
        totalTimeoutMs: 30000,
        cacheMode: "Off",
        onBudgetBreach: "Fail",
        allowOutOfRegionFailover: false,
      },
    },
    true,
  );
}
