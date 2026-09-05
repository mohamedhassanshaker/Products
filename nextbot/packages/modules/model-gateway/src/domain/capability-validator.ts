import type { ModelCapabilitiesValue, ModelModalityValue, ModelProviderTypeValue, RegionValue as Region } from "@nextbot/contracts";
import { RouteCapabilityUnsatisfiedError } from "@nextbot/contracts";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, ADR-0011 §2.2, LLD §14.8.4,
 * FR-AGT-22) — the save-time capability/residency validator. Pure domain logic (no DB,
 * no I/O) so it is exhaustively unit-testable and cannot violate
 * `no-db-inside-domain`. Called from `application/route-service.ts` on EVERY
 * `model_route_version` save; `errors.length > 0` means the caller must reject the
 * save with a 422, never accept it and fail later at call time.
 */

export interface RouteCapabilityHop {
  ordinal: number;
  provider: {
    id: string;
    name: string;
    type: ModelProviderTypeValue;
    region: Region;
    retainsPrompts: boolean;
    trainsOnData: boolean;
    status: "Active" | "Unreachable" | "Disabled" | "CredentialInvalid";
    enabled: boolean;
  };
  entry: {
    id: string;
    modelId: string;
    displayName: string;
    modality: ModelModalityValue;
    contextWindow: number;
    maxOutput: number;
    dimension: number | null;
    capabilitiesJson: ModelCapabilitiesValue;
    status: "Available" | "Preview" | "Deprecating" | "Retired";
  };
}

export interface RouteCapabilityContext {
  hops: RouteCapabilityHop[];
  /** The route's own declared modality expectation (e.g. an `embed.default`-role
   * route's hops must all be `Embedding` entries) — `null` when the route's role
   * doesn't constrain modality (`custom`/`chat.*`/`vision.default`, which may
   * legitimately mix `Text`/`Vision`/`Multimodal`). */
  expectedModality: ModelModalityValue | null;
  tenantResidency: { region: Region; allowOutOfRegionInference: boolean };
  /** FR-AGT-26 — the set of provider types this tenant's plan tier may attach at
   * all; `null` means "no restriction configured" (the shipped-permissive default). */
  allowedProviderTypesForPlanTier: ModelProviderTypeValue[] | null;
  policy: { allowOutOfRegionFailover: boolean };
}

export type RouteValidationCode =
  | "ROUTE_EMPTY_CHAIN"
  | "ROUTE_CAPABILITY_DEGRADED_BY_HOP"
  | "ROUTE_RESIDENCY_VIOLATION"
  | "ROUTE_MODEL_RETIRED"
  | "ROUTE_MODEL_DEPRECATING"
  | "ROUTE_MODALITY_MISMATCH"
  | "ROUTE_EMBEDDING_DIMENSION_MISMATCH"
  | "ROUTE_PROVIDER_DISABLED"
  | "ROUTE_PROVIDER_TYPE_NOT_ALLOWED_FOR_PLAN"
  | "ROUTE_CONTEXT_WINDOW_SHRINKS_ON_FALLBACK"
  | "ROUTE_DATA_HANDLING_STRICTER_ON_FALLBACK";

export interface RouteValidationIssue {
  path: string;
  code: RouteValidationCode;
  message: string;
}

export interface RouteCapabilityResult {
  /** The INTERSECTION across every hop — the weakest hop wins (FR-AGT-22). */
  advertisedCapabilities: ModelCapabilitiesValue;
  strictestDataHandling: { retainsPrompts: boolean; trainsOnData: boolean };
  /** min(context_window)/min(max_output) across hops — a fallback with a smaller
   * window silently truncating is the same class of surprise as a dropped capability. */
  effectiveContextWindow: number;
  effectiveMaxOutput: number;
  /** Embedding routes only: every hop MUST agree on dimension (FR-KB-03). `null` when
   * no hop declares one (non-embedding routes). */
  embeddingDimension: number | null;
  regionSet: Region[];
  errors: RouteValidationIssue[];
  warnings: RouteValidationIssue[];
}

const ALL_CAPABILITY_KEYS = [
  "toolCalling",
  "vision",
  "streaming",
  "structuredOutput",
  "extendedThinking",
  "promptCaching",
  "jsonMode",
] as const satisfies ReadonlyArray<keyof ModelCapabilitiesValue>;

function intersectCapabilities(hops: RouteCapabilityHop[]): ModelCapabilitiesValue {
  const result = {} as ModelCapabilitiesValue;
  for (const key of ALL_CAPABILITY_KEYS) {
    result[key] = hops.every((h) => h.entry.capabilitiesJson[key]);
  }
  return result;
}

/**
 * Pure. Called on EVERY `model_route_version` save. `errors.length > 0` -> the
 * caller must return a 422 and refuse the save (LLD §14.8.4).
 *
 * `ROUTE_RESIDENCY_VIOLATION` is an error unless BOTH `policy.allowOutOfRegionFailover`
 * AND `tenantResidency.allowOutOfRegionInference` are true (FR-AGT-25 extends FR-SEC-05
 * to the model layer; the tenant-level opt-in cannot be overridden by a route author
 * alone — both gates must be open, never either).
 */
export function validateRouteCapabilities(ctx: RouteCapabilityContext): RouteCapabilityResult {
  const errors: RouteValidationIssue[] = [];
  const warnings: RouteValidationIssue[] = [];

  if (ctx.hops.length === 0) {
    errors.push({ path: "chain", code: "ROUTE_EMPTY_CHAIN", message: "A route version must have at least one hop." });
    return {
      advertisedCapabilities: intersectCapabilities([]),
      strictestDataHandling: { retainsPrompts: false, trainsOnData: false },
      effectiveContextWindow: 0,
      effectiveMaxOutput: 0,
      embeddingDimension: null,
      regionSet: [],
      errors,
      warnings,
    };
  }

  const sorted = [...ctx.hops].sort((a, b) => a.ordinal - b.ordinal);
  const regionSet = new Set<Region>();
  let retainsPrompts = false;
  let trainsOnData = false;
  let effectiveContextWindow = Infinity;
  let effectiveMaxOutput = Infinity;
  let embeddingDimension: number | null = null;
  let dimensionMismatch = false;

  sorted.forEach((hop, idx) => {
    const path = `chain[${idx}]`;
    regionSet.add(hop.provider.region);
    retainsPrompts = retainsPrompts || hop.provider.retainsPrompts;
    trainsOnData = trainsOnData || hop.provider.trainsOnData;
    effectiveContextWindow = Math.min(effectiveContextWindow, hop.entry.contextWindow);
    effectiveMaxOutput = Math.min(effectiveMaxOutput, hop.entry.maxOutput);

    if (hop.entry.dimension != null) {
      if (embeddingDimension === null) embeddingDimension = hop.entry.dimension;
      else if (embeddingDimension !== hop.entry.dimension) dimensionMismatch = true;
    }

    if (hop.entry.status === "Retired") {
      errors.push({ path, code: "ROUTE_MODEL_RETIRED", message: `Hop ${idx} (${hop.entry.displayName}) references a retired model.` });
    } else if (hop.entry.status === "Deprecating") {
      warnings.push({ path, code: "ROUTE_MODEL_DEPRECATING", message: `Hop ${idx} (${hop.entry.displayName}) is deprecating.` });
    }

    if (!hop.provider.enabled || hop.provider.status === "Disabled") {
      errors.push({ path, code: "ROUTE_PROVIDER_DISABLED", message: `Hop ${idx}'s provider (${hop.provider.name}) is disabled.` });
    }

    if (ctx.expectedModality && hop.entry.modality !== ctx.expectedModality && hop.entry.modality !== "Multimodal") {
      errors.push({
        path,
        code: "ROUTE_MODALITY_MISMATCH",
        message: `Hop ${idx} (${hop.entry.displayName}) is '${hop.entry.modality}', but this route requires '${ctx.expectedModality}'.`,
      });
    }

    if (ctx.allowedProviderTypesForPlanTier && !ctx.allowedProviderTypesForPlanTier.includes(hop.provider.type)) {
      errors.push({
        path,
        code: "ROUTE_PROVIDER_TYPE_NOT_ALLOWED_FOR_PLAN",
        message: `Hop ${idx}'s provider type '${hop.provider.type}' is not permitted for this tenant's plan tier.`,
      });
    }

    const outOfRegion = hop.provider.region !== ctx.tenantResidency.region;
    if (outOfRegion) {
      const bothOptedIn = ctx.policy.allowOutOfRegionFailover && ctx.tenantResidency.allowOutOfRegionInference;
      if (!bothOptedIn) {
        errors.push({
          path,
          code: "ROUTE_RESIDENCY_VIOLATION",
          message: `Hop ${idx}'s provider (${hop.provider.name}) is in region '${hop.provider.region}', outside this tenant's residency region '${ctx.tenantResidency.region}'.`,
        });
      }
    }
  });

  if (dimensionMismatch) {
    errors.push({
      path: "chain",
      code: "ROUTE_EMBEDDING_DIMENSION_MISMATCH",
      message: "Every hop in an embedding route's chain must agree on vector dimension.",
    });
  }

  const advertisedCapabilities = intersectCapabilities(sorted);
  const primary = sorted[0]!;
  for (const key of ALL_CAPABILITY_KEYS) {
    if (primary.entry.capabilitiesJson[key] && !advertisedCapabilities[key]) {
      warnings.push({
        path: "chain",
        code: "ROUTE_CAPABILITY_DEGRADED_BY_HOP",
        message: `The primary hop supports '${key}', but a fallback hop does not — this route's advertised set drops it.`,
      });
    }
  }

  for (let i = 1; i < sorted.length; i++) {
    const hop = sorted[i]!;
    if (hop.entry.contextWindow < primary.entry.contextWindow) {
      warnings.push({ path: `chain[${i}]`, code: "ROUTE_CONTEXT_WINDOW_SHRINKS_ON_FALLBACK", message: `Hop ${i} has a smaller context window than the primary hop.` });
    }
    if ((hop.provider.retainsPrompts && !primary.provider.retainsPrompts) || (hop.provider.trainsOnData && !primary.provider.trainsOnData)) {
      warnings.push({ path: `chain[${i}]`, code: "ROUTE_DATA_HANDLING_STRICTER_ON_FALLBACK", message: `Hop ${i}'s data-handling flags are stricter than the primary hop's.` });
    }
  }

  return {
    advertisedCapabilities,
    strictestDataHandling: { retainsPrompts, trainsOnData },
    effectiveContextWindow: effectiveContextWindow === Infinity ? 0 : effectiveContextWindow,
    effectiveMaxOutput: effectiveMaxOutput === Infinity ? 0 : effectiveMaxOutput,
    embeddingDimension,
    regionSet: [...regionSet],
    errors,
    warnings,
  };
}

/**
 * FR-AGT-22's second half: an agent version declaring a required capability is
 * rejected AT ITS SAVE if its pinned route version's `advertised_capabilities` (the
 * intersection already computed and frozen by {@link validateRouteCapabilities} at
 * route-save time) does not satisfy it. Pure — never re-derives the intersection,
 * always trusts the frozen, immutable `advertised_capabilities` column, exactly as
 * LLD §14.8.2 requires ("stored, not recomputed at runtime").
 *
 * @throws {RouteCapabilityUnsatisfiedError} naming every missing capability (not just
 * the first one found).
 */
export function assertRouteSatisfies(
  required: Partial<ModelCapabilitiesValue> & { minContextWindow?: number; embeddingDimension?: number },
  routeVersion: { advertisedCapabilities: ModelCapabilitiesValue; effectiveContextWindow?: number; embeddingDimension?: number | null },
  routeLabel: string,
): void {
  const missing: string[] = [];
  for (const key of ALL_CAPABILITY_KEYS) {
    if (required[key] === true && !routeVersion.advertisedCapabilities[key]) {
      missing.push(key);
    }
  }
  if (required.minContextWindow !== undefined && routeVersion.effectiveContextWindow !== undefined && routeVersion.effectiveContextWindow < required.minContextWindow) {
    missing.push("minContextWindow");
  }
  if (required.embeddingDimension !== undefined && routeVersion.embeddingDimension !== undefined && routeVersion.embeddingDimension !== required.embeddingDimension) {
    missing.push("embeddingDimension");
  }
  if (missing.length > 0) {
    throw new RouteCapabilityUnsatisfiedError(routeLabel, missing);
  }
}
