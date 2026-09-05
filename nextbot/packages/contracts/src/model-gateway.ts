import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";

/**
 * Target Architecture Blueprint Phase 1 (BL-32, ADR-0011, LLD §14.8) — TypeBox
 * contracts for `@nextbot/model-gateway`'s Provider Registry + Model Catalog surface.
 * Phase 2 (BL-33) adds Route v2 / usage-cost / governance schemas below.
 */

// ---------------------------------------------------------------------------
// Shared vocabularies (ADR-0011 §2.1)
// ---------------------------------------------------------------------------

export const ModelProviderType = Type.Union([
  Type.Literal("openai"),
  Type.Literal("anthropic"),
  Type.Literal("gemini"),
  Type.Literal("azure-openai"),
  Type.Literal("openai-compatible"),
  Type.Literal("google-vertex"),
  Type.Literal("bedrock"),
  Type.Literal("openrouter"),
  Type.Literal("ollama"),
  Type.Literal("cohere"),
  Type.Literal("mistral"),
  Type.Literal("custom"),
]);
export type ModelProviderTypeValue = Static<typeof ModelProviderType>;

export const ModelProviderStatus = Type.Union([
  Type.Literal("Active"),
  Type.Literal("Unreachable"),
  Type.Literal("Disabled"),
  Type.Literal("CredentialInvalid"),
]);
export type ModelProviderStatusValue = Static<typeof ModelProviderStatus>;

export const ModelAuthMethod = Type.Union([
  Type.Literal("ApiKey"),
  Type.Literal("EntraId"),
  Type.Literal("ServiceAccount"),
  Type.Literal("IamRole"),
  Type.Literal("Mtls"),
  Type.Literal("None"),
]);
export type ModelAuthMethodValue = Static<typeof ModelAuthMethod>;

export const ModelModality = Type.Union([
  Type.Literal("Text"),
  Type.Literal("Vision"),
  Type.Literal("Audio"),
  Type.Literal("Embedding"),
  Type.Literal("Rerank"),
  Type.Literal("Multimodal"),
]);
export type ModelModalityValue = Static<typeof ModelModality>;

export const ModelCatalogStatus = Type.Union([
  Type.Literal("Available"),
  Type.Literal("Preview"),
  Type.Literal("Deprecating"),
  Type.Literal("Retired"),
]);
export type ModelCatalogStatusValue = Static<typeof ModelCatalogStatus>;

export const ModelCatalogSource = Type.Union([Type.Literal("Synced"), Type.Literal("Manual")]);
export type ModelCatalogSourceValue = Static<typeof ModelCatalogSource>;

/** Every flag REQUIRED (LLD §14.8.2) — an unknown/unset capability is explicitly
 * `false`, never absent, so a save-time capability check (Phase 2) can never silently
 * treat "we don't know" as "assume yes". */
export const ModelCapabilitiesSchema = Type.Object({
  toolCalling: Type.Boolean(),
  vision: Type.Boolean(),
  streaming: Type.Boolean(),
  structuredOutput: Type.Boolean(),
  extendedThinking: Type.Boolean(),
  promptCaching: Type.Boolean(),
  jsonMode: Type.Boolean(),
});
export type ModelCapabilitiesValue = Static<typeof ModelCapabilitiesSchema>;

// ---------------------------------------------------------------------------
// Provider Registry requests
// ---------------------------------------------------------------------------

export const CreateModelProviderRequestSchema = Type.Object({
  type: ModelProviderType,
  name: Type.String({ minLength: 1, maxLength: 200 }),
  baseUrl: Type.Optional(Type.String({ format: "uri" })),
  region: Type.Optional(Type.Union([Type.Literal("UAE"), Type.Literal("EU"), Type.Literal("US")])),
  regionsServed: Type.Optional(Type.Array(Type.String())),
  authMethod: Type.Optional(ModelAuthMethod),
  /** Vaulted on save — never persisted as plaintext (same convention as every other
   * credential field in this codebase). */
  apiKeyPlaintext: Type.Optional(Type.String({ minLength: 1 })),
  orgOrProjectId: Type.Optional(Type.String()),
  retainsPrompts: Type.Optional(Type.Boolean()),
  trainsOnData: Type.Optional(Type.Boolean()),
  rateLimitJson: Type.Optional(
    Type.Object(
      {
        requestsPerMinute: Type.Optional(Type.Integer({ minimum: 1 })),
        tokensPerMinute: Type.Optional(Type.Integer({ minimum: 1 })),
        maxConcurrent: Type.Optional(Type.Integer({ minimum: 1 })),
      },
      { additionalProperties: false },
    ),
  ),
  healthIntervalSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 3600 })),
  enabled: Type.Optional(Type.Boolean()),
});
export type CreateModelProviderRequest = Static<typeof CreateModelProviderRequestSchema>;

export const UpdateModelProviderRequestSchema = Type.Object({
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 200 })),
  baseUrl: Type.Optional(Type.String({ format: "uri" })),
  region: Type.Optional(Type.Union([Type.Literal("UAE"), Type.Literal("EU"), Type.Literal("US")])),
  regionsServed: Type.Optional(Type.Array(Type.String())),
  apiKeyPlaintext: Type.Optional(Type.String({ minLength: 1 })),
  orgOrProjectId: Type.Optional(Type.String()),
  retainsPrompts: Type.Optional(Type.Boolean()),
  trainsOnData: Type.Optional(Type.Boolean()),
  rateLimitJson: Type.Optional(
    Type.Object(
      {
        requestsPerMinute: Type.Optional(Type.Integer({ minimum: 1 })),
        tokensPerMinute: Type.Optional(Type.Integer({ minimum: 1 })),
        maxConcurrent: Type.Optional(Type.Integer({ minimum: 1 })),
      },
      { additionalProperties: false },
    ),
  ),
  healthIntervalSeconds: Type.Optional(Type.Integer({ minimum: 30, maximum: 3600 })),
  enabled: Type.Optional(Type.Boolean()),
});
export type UpdateModelProviderRequest = Static<typeof UpdateModelProviderRequestSchema>;

// ---------------------------------------------------------------------------
// Model Catalog requests (manual declaration — FR-AGT-21)
// ---------------------------------------------------------------------------

export const CreateModelCatalogEntryRequestSchema = Type.Object({
  providerId: Type.String({ format: "uuid" }),
  modelId: Type.String({ minLength: 1 }),
  displayName: Type.String({ minLength: 1 }),
  modality: ModelModality,
  contextWindow: Type.Integer({ minimum: 1 }),
  maxOutput: Type.Integer({ minimum: 1 }),
  dimension: Type.Optional(Type.Integer({ minimum: 1 })),
  capabilities: ModelCapabilitiesSchema,
  tokenizer: Type.String({ minLength: 1 }),
  priceIn: Type.Optional(Type.Number({ minimum: 0 })),
  priceOut: Type.Optional(Type.Number({ minimum: 0 })),
  priceCached: Type.Optional(Type.Number({ minimum: 0 })),
  deprecatesAt: Type.Optional(Type.String({ format: "date-time" })),
});
export type CreateModelCatalogEntryRequest = Static<typeof CreateModelCatalogEntryRequestSchema>;

export const UpdateModelCatalogEntryRequestSchema = Type.Object({
  displayName: Type.Optional(Type.String({ minLength: 1 })),
  contextWindow: Type.Optional(Type.Integer({ minimum: 1 })),
  maxOutput: Type.Optional(Type.Integer({ minimum: 1 })),
  dimension: Type.Optional(Type.Integer({ minimum: 1 })),
  capabilities: Type.Optional(ModelCapabilitiesSchema),
  priceIn: Type.Optional(Type.Number({ minimum: 0 })),
  priceOut: Type.Optional(Type.Number({ minimum: 0 })),
  priceCached: Type.Optional(Type.Number({ minimum: 0 })),
  status: Type.Optional(ModelCatalogStatus),
  deprecatesAt: Type.Optional(Type.String({ format: "date-time" })),
});
export type UpdateModelCatalogEntryRequest = Static<typeof UpdateModelCatalogEntryRequestSchema>;

// ---------------------------------------------------------------------------
// Domain errors (RFC 9457, LLD §11.2)
// ---------------------------------------------------------------------------

export class ModelProviderNotFoundError extends DomainError {
  readonly code = "MODEL_PROVIDER_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Model provider '${id}' was not found.`);
  }
}

export class ModelProviderBaseUrlRequiredError extends DomainError {
  readonly code = "MODEL_PROVIDER_BASE_URL_REQUIRED";
  readonly httpStatus = 422;
  constructor(type: string) {
    super(`Provider type '${type}' requires a base URL (it has no default hosted endpoint).`, [
      { path: "baseUrl", code: "MODEL_PROVIDER_BASE_URL_REQUIRED", message: "A base URL is required for this provider type." },
    ]);
  }
}

export class ModelProviderTypeUnsupportedError extends DomainError {
  readonly code = "PROVIDER_TYPE_UNSUPPORTED";
  readonly httpStatus = 422;
  constructor(type: string) {
    super(`Provider type '${type}' has no registered adapter.`);
  }
}

export class ModelCatalogEntryNotFoundError extends DomainError {
  readonly code = "MODEL_CATALOG_ENTRY_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Model catalog entry '${id}' was not found.`);
  }
}

export class ModelCatalogSyncUnsupportedError extends DomainError {
  readonly code = "MODEL_CATALOG_SYNC_UNSUPPORTED";
  readonly httpStatus = 422;
  constructor(type: string) {
    super(`Provider type '${type}' has no catalog-sync mechanism — declare its models manually instead.`);
  }
}

// ---------------------------------------------------------------------------
// Phase 2 (BL-33, LLD §14.8.2/§14.8.4) — Route v2, capability validation,
// usage/cost, residency + plan-tier governance.
// ---------------------------------------------------------------------------

export const ModelRouteRole = Type.Union([
  Type.Literal("chat.primary"),
  Type.Literal("chat.router"),
  Type.Literal("embed.default"),
  Type.Literal("rerank.default"),
  Type.Literal("vision.default"),
  Type.Literal("custom"),
]);
export type ModelRouteRoleValue = Static<typeof ModelRouteRole>;

export const ModelRouteVersionStatus = Type.Union([
  Type.Literal("Draft"),
  Type.Literal("Published"),
  Type.Literal("Deprecated"),
]);
export type ModelRouteVersionStatusValue = Static<typeof ModelRouteVersionStatus>;

/** LLD §14.8.2's `ModelRouteHopSchema` — a hop references a real, priced,
 * capability-described `model_catalog_entry`, NEVER a free-text model string
 * (FR-AGT-21, closing gap G-05). */
export const ModelRouteHopSchema = Type.Object(
  {
    ordinal: Type.Integer({ minimum: 0 }),
    providerId: Type.String({ format: "uuid" }),
    catalogEntryId: Type.String({ format: "uuid" }),
    params: Type.Object(
      {
        temperature: Type.Optional(Type.Number({ minimum: 0, maximum: 2 })),
        maxTokens: Type.Optional(Type.Integer({ minimum: 1 })),
        topP: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
        reasoningEffort: Type.Optional(Type.String()),
      },
      { additionalProperties: false },
    ),
    weight: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
    timeoutMs: Type.Integer({ minimum: 500, maximum: 300_000 }),
  },
  { additionalProperties: false },
);
export type ModelRouteHopValue = Static<typeof ModelRouteHopSchema>;

export const ModelRouteChainSchema = Type.Array(ModelRouteHopSchema, { minItems: 1, maxItems: 8 });

export const FailoverCondition = Type.Union([
  Type.Literal("429"),
  Type.Literal("5xx"),
  Type.Literal("timeout"),
  Type.Literal("content_filter"),
  Type.Literal("context_overflow"),
]);
export type FailoverConditionValue = Static<typeof FailoverCondition>;

/** LLD §14.8.2's `ModelRoutePolicySchema`. `allowOutOfRegionFailover` defaults
 * `false` (FR-AGT-22/25) — a route author cannot loosen this past the tenant's own
 * `allowOutOfRegionInference` opt-in (both must be true, never either). */
export const ModelRoutePolicySchema = Type.Object(
  {
    strategy: Type.Union([
      Type.Literal("FixedPriority"),
      Type.Literal("CostBased"),
      Type.Literal("LatencyBased"),
      Type.Literal("Weighted"),
    ]),
    failoverOn: Type.Array(FailoverCondition, { minItems: 1 }),
    retry: Type.Object({
      maxPerHop: Type.Integer({ minimum: 0, maximum: 3 }),
      backoff: Type.Union([Type.Literal("none"), Type.Literal("exponential")]),
    }),
    totalTimeoutMs: Type.Integer({ minimum: 1000, maximum: 300_000 }),
    cacheMode: Type.Union([Type.Literal("Off"), Type.Literal("ExactMatch"), Type.Literal("Semantic")]),
    semanticThreshold: Type.Optional(Type.Number({ minimum: 0, maximum: 1 })),
    costCeilingUsdPerTurn: Type.Optional(Type.Number({ minimum: 0 })),
    onBudgetBreach: Type.Union([Type.Literal("DegradeToCheapestHop"), Type.Literal("Fail")]),
    allowOutOfRegionFailover: Type.Boolean(),
  },
  { additionalProperties: false },
);
export type ModelRoutePolicyValue = Static<typeof ModelRoutePolicySchema>;

export const CreateModelRouteRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Type.String({ maxLength: 2000 })),
  role: Type.Optional(ModelRouteRole),
});
export type CreateModelRouteRequest = Static<typeof CreateModelRouteRequestSchema>;

/** A new immutable version for an existing route (FR-AGT-22 — "editing a route
 * creates a new route version and changes nothing already promoted"). */
export const CreateModelRouteVersionRequestSchema = Type.Object({
  chain: ModelRouteChainSchema,
  policy: ModelRoutePolicySchema,
});
export type CreateModelRouteVersionRequest = Static<typeof CreateModelRouteVersionRequestSchema>;

// ---------------------------------------------------------------------------
// Domain errors — Route v2
// ---------------------------------------------------------------------------

export class ModelRouteNotFoundError extends DomainError {
  readonly code = "MODEL_ROUTE_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Model route '${id}' was not found.`);
  }
}

export class ModelRouteNameDuplicateError extends DomainError {
  readonly code = "MODEL_ROUTE_NAME_DUPLICATE";
  readonly httpStatus = 409;
  constructor(name: string) {
    super(`A model route named '${name}' already exists.`);
  }
}

export class ModelRouteVersionNotFoundError extends DomainError {
  readonly code = "MODEL_ROUTE_VERSION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor(id: string) {
    super(`Model route version '${id}' was not found.`);
  }
}

/** FR-AGT-22 — the save-time capability/residency/plan-tier validator rejected this
 * route version. `fields` carries one entry per `RouteValidationCode` error found
 * (never just the first one), each naming the offending hop where applicable. */
export class RouteValidationFailedError extends DomainError {
  readonly code = "ROUTE_VALIDATION_FAILED";
  readonly httpStatus = 422;
  constructor(fields: Array<{ path: string; code: string; message: string }>) {
    super("This route version cannot be saved — it failed capability/residency validation.", fields);
  }
}

/** FR-AGT-22's second half — an agent version declaring a required capability is
 * rejected AT ITS OWN SAVE if its pinned route version's `advertised_capabilities`
 * (the intersection across every hop) does not satisfy it. Never a runtime surprise. */
export class RouteCapabilityUnsatisfiedError extends DomainError {
  readonly code = "AGENT_ROUTE_CAPABILITY_UNSATISFIED";
  readonly httpStatus = 422;
  constructor(routeLabel: string, missing: string[]) {
    super(
      `Route '${routeLabel}' does not support the capabilities this agent version requires: ${missing.join(", ")}.`,
      missing.map((m) => ({ path: `requiredCapabilities.${m}`, code: "AGENT_ROUTE_CAPABILITY_UNSATISFIED", message: `Route does not advertise '${m}'.` })),
    );
  }
}

