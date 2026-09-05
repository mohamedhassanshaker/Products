import type { TenantContext } from "@nextbot/db";
import { getTenantDataPolicy, getAllowOutOfRegionInference, getTenantPlanTier, getProviderTypePolicyForTier } from "@nextbot/tenancy";
import {
  RouteValidationFailedError,
  ModelRouteNotFoundError,
  ModelRouteVersionNotFoundError,
  type ModelRouteRoleValue,
  type ModelRouteHopValue,
  type ModelRoutePolicyValue,
  type ModelModalityValue,
  type ModelProviderTypeValue,
} from "@nextbot/contracts";
import { validateRouteCapabilities, type RouteCapabilityHop } from "../domain/capability-validator.js";
import { getProvider, getCatalogEntry } from "../infrastructure/model-gateway-repository.js";
import {
  createRoute as insertRoute,
  getRoute,
  getRouteByName,
  listRoutes as listRouteRows,
  listRouteVersions,
  getRouteVersion,
  insertRouteVersion,
  publishRouteVersion as publishRouteVersionRow,
  setRouteCurrentVersion,
  type ModelRouteRow,
  type ModelRouteVersionRow,
} from "../infrastructure/route-repository.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, ADR-0011 §2.2, LLD §14.8.4,
 * FR-AGT-20-26) — Route v2 application service: create routes, create/validate/
 * publish immutable route versions, enforce residency (FR-AGT-25) and plan-tier
 * governance (FR-AGT-26) at SAVE time, never at call time.
 */

/** A route's `role` constrains which catalog modality its hops must be
 * (FR-AGT-23's standard-route checklist) — `custom` (and any role not listed) is
 * unconstrained, since a bespoke route may legitimately mix modalities. */
function expectedModalityForRole(role: ModelRouteRoleValue): ModelModalityValue | null {
  switch (role) {
    case "embed.default":
      return "Embedding";
    case "rerank.default":
      return "Rerank";
    case "vision.default":
      return "Vision";
    default:
      return null;
  }
}

export async function createRoute(ctx: TenantContext, input: { name: string; description?: string; role?: ModelRouteRoleValue }): Promise<ModelRouteRow> {
  return insertRoute(ctx, input);
}

export async function listRoutes(ctx: TenantContext): Promise<ModelRouteRow[]> {
  return listRouteRows(ctx);
}

export async function getRouteOrThrow(ctx: TenantContext, id: string): Promise<ModelRouteRow> {
  const row = await getRoute(ctx, id);
  if (!row) throw new ModelRouteNotFoundError(id);
  return row;
}

export async function listVersionsForRoute(ctx: TenantContext, routeId: string): Promise<ModelRouteVersionRow[]> {
  await getRouteOrThrow(ctx, routeId);
  return listRouteVersions(ctx, routeId);
}

/** Resolves each request hop (providerId + catalogEntryId) into the full
 * `RouteCapabilityHop` shape `validateRouteCapabilities` needs, throwing a
 * field-scoped validation error immediately if a referenced provider/catalog entry
 * doesn't exist or doesn't belong to this tenant (RLS already narrows visibility to
 * "own + platform-shared", so a hit here means it's genuinely usable). */
async function resolveHops(ctx: TenantContext, hops: ModelRouteHopValue[]): Promise<{ resolved: RouteCapabilityHop[]; errors: Array<{ path: string; code: string; message: string }> }> {
  const errors: Array<{ path: string; code: string; message: string }> = [];
  const resolved: RouteCapabilityHop[] = [];
  for (const hop of hops) {
    const provider = await getProvider(ctx, hop.providerId);
    const entry = await getCatalogEntry(ctx, hop.catalogEntryId);
    if (!provider) {
      errors.push({ path: `chain[${hop.ordinal}].providerId`, code: "MODEL_PROVIDER_NOT_FOUND", message: `Provider '${hop.providerId}' was not found.` });
      continue;
    }
    if (!entry || entry.providerId !== provider.id) {
      errors.push({ path: `chain[${hop.ordinal}].catalogEntryId`, code: "MODEL_CATALOG_ENTRY_NOT_FOUND", message: `Catalog entry '${hop.catalogEntryId}' was not found for provider '${hop.providerId}'.` });
      continue;
    }
    resolved.push({
      ordinal: hop.ordinal,
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.type,
        region: provider.region,
        retainsPrompts: provider.retainsPrompts,
        trainsOnData: provider.trainsOnData,
        status: provider.status,
        enabled: provider.enabled,
      },
      entry: {
        id: entry.id,
        modelId: entry.modelId,
        displayName: entry.displayName,
        modality: entry.modality,
        contextWindow: entry.contextWindow,
        maxOutput: entry.maxOutput,
        dimension: entry.dimension,
        capabilitiesJson: entry.capabilitiesJson,
        status: entry.status,
      },
    });
  }
  return { resolved, errors };
}

/**
 * Creates a new immutable route version (FR-AGT-22: "editing a route creates a new
 * route version and changes nothing already promoted"). Runs the FULL save-time
 * validator (capability intersection, residency FR-AGT-25, plan-tier FR-AGT-26,
 * modality/deprecation/disabled-provider checks) and REFUSES the save
 * (`RouteValidationFailedError`, 422) if any error is found — never accepts a route
 * that would fail later at call time.
 *
 * @param publish When true, the new version is created directly as `Published` and
 * becomes the route's `current_version_id` (the console's "Save & Publish" action);
 * when false it is left `Draft` (a dry run / staged edit, per the API's
 * `.../versions/validate` endpoint reusing this same path with `publish: false` and
 * discarding the result rather than committing it — see `handleValidateRouteVersion`).
 */
export async function createRouteVersion(
  ctx: TenantContext,
  routeId: string,
  input: { chain: ModelRouteHopValue[]; policy: ModelRoutePolicyValue; createdByUserId?: string },
  publish: boolean,
): Promise<ModelRouteVersionRow> {
  const route = await getRouteOrThrow(ctx, routeId);
  const { resolved, errors: resolutionErrors } = await resolveHops(ctx, input.chain);

  if (resolutionErrors.length > 0) {
    throw new RouteValidationFailedError(resolutionErrors);
  }

  const [dataPolicy, allowOutOfRegionInference, planTier] = await Promise.all([
    getTenantDataPolicy(ctx),
    getAllowOutOfRegionInference(ctx),
    getTenantPlanTier(ctx),
  ]);
  const policy = await getProviderTypePolicyForTier(planTier);

  const result = validateRouteCapabilities({
    hops: resolved,
    expectedModality: expectedModalityForRole(route.role),
    tenantResidency: { region: dataPolicy?.residencyRegion ?? ctx.region, allowOutOfRegionInference },
    allowedProviderTypesForPlanTier: (policy?.allowedProviderTypes as ModelProviderTypeValue[] | undefined) ?? null,
    policy: { allowOutOfRegionFailover: input.policy.allowOutOfRegionFailover },
  });

  if (result.errors.length > 0) {
    throw new RouteValidationFailedError(result.errors);
  }

  const existingVersions = await listRouteVersions(ctx, routeId);
  const nextVersion = (existingVersions[0]?.version ?? 0) + 1;

  const versionRow = await insertRouteVersion(ctx, {
    routeId,
    version: nextVersion,
    chainJson: input.chain,
    policyJson: input.policy,
    advertisedCapabilities: result.advertisedCapabilities,
    strictestDataHandling: result.strictestDataHandling,
    maxRegionSet: result.regionSet,
    status: publish ? "Published" : "Draft",
    createdByUserId: input.createdByUserId,
  });

  if (publish) {
    await setRouteCurrentVersion(ctx, routeId, versionRow.id);
  }

  return versionRow;
}

/** Dry-run validation (`.../versions/validate`, LLD §14.8.5) — runs the identical
 * validator as {@link createRouteVersion} but never writes anything, for a console
 * "check before you save" affordance. */
export async function validateRouteVersionDryRun(
  ctx: TenantContext,
  routeId: string,
  input: { chain: ModelRouteHopValue[]; policy: ModelRoutePolicyValue },
) {
  const route = await getRouteOrThrow(ctx, routeId);
  const { resolved, errors: resolutionErrors } = await resolveHops(ctx, input.chain);
  if (resolutionErrors.length > 0) {
    return { advertisedCapabilities: null, errors: resolutionErrors, warnings: [] };
  }
  const [dataPolicy, allowOutOfRegionInference, planTier] = await Promise.all([
    getTenantDataPolicy(ctx),
    getAllowOutOfRegionInference(ctx),
    getTenantPlanTier(ctx),
  ]);
  const policy = await getProviderTypePolicyForTier(planTier);
  return validateRouteCapabilities({
    hops: resolved,
    expectedModality: expectedModalityForRole(route.role),
    tenantResidency: { region: dataPolicy?.residencyRegion ?? ctx.region, allowOutOfRegionInference },
    allowedProviderTypesForPlanTier: (policy?.allowedProviderTypes as ModelProviderTypeValue[] | undefined) ?? null,
    policy: { allowOutOfRegionFailover: input.policy.allowOutOfRegionFailover },
  });
}

export async function publishRouteVersion(ctx: TenantContext, routeId: string, versionId: string): Promise<ModelRouteVersionRow> {
  await getRouteOrThrow(ctx, routeId);
  const version = await getRouteVersion(ctx, versionId);
  if (!version || version.routeId !== routeId) throw new ModelRouteVersionNotFoundError(versionId);
  const published = await publishRouteVersionRow(ctx, versionId);
  await setRouteCurrentVersion(ctx, routeId, versionId);
  return published;
}

/** FR-AGT-23's "standard routes" checklist (`GET .../standard-routes`) — which of
 * the recommended per-role route names this tenant has actually configured. */
export async function getStandardRoutesChecklist(ctx: TenantContext): Promise<Array<{ role: ModelRouteRoleValue; configured: boolean; routeId: string | null }>> {
  const roles: ModelRouteRoleValue[] = ["chat.primary", "chat.router", "embed.default", "rerank.default", "vision.default"];
  const routes = await listRouteRows(ctx);
  return roles.map((role) => {
    const match = routes.find((r) => r.role === role) ?? routes.find((r) => r.name === role);
    return { role, configured: Boolean(match), routeId: match?.id ?? null };
  });
}

export { getRouteByName };
