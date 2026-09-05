import { Type, type Static } from "@sinclair/typebox";

/**
 * Validates `tenant.branding_config` writes (FR-ADM-07). Mirrors the shape of
 * `TenantBrandingConfig` in `packages/db/src/schema/tenancy.ts` — kept in sync by
 * hand since the two packages must not depend on each other at runtime (LLD §3.1:
 * "every jsonb column has a TypeBox schema… validated on write").
 */
/**
 * FR-ADM-07 logo/favicon storage: no object-store (S3-compatible blob) integration
 * exists yet in this codebase — building one is real infra work out of this phase's
 * scope (flagged, same category as the Enterprise dedicated-database escape hatch
 * being routing-only in Phase 1). Logos/favicons are instead stored as `data:` URLs
 * directly inside the `branding_config` jsonb column, capped generously above the
 * spec's own "max 2 MB" upload limit to account for base64's ~37% size overhead —
 * the 2 MB enforcement itself happens client-side at the file-picker (before
 * encoding) and is re-checked here structurally via this length cap.
 */
const LOGO_URL_MAX_LENGTH = 3_000_000;

export const TenantBrandingSchema = Type.Object({
  primaryColor: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
  secondaryColor: Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }),
  logoLightUrl: Type.Union([Type.String({ format: "uri", maxLength: LOGO_URL_MAX_LENGTH }), Type.Null()]),
  logoDarkUrl: Type.Union([Type.String({ format: "uri", maxLength: LOGO_URL_MAX_LENGTH }), Type.Null()]),
  faviconUrl: Type.Union([Type.String({ format: "uri", maxLength: LOGO_URL_MAX_LENGTH }), Type.Null()]),
  fontFamily: Type.Union([Type.String(), Type.Null()]),
});
export type TenantBranding = Static<typeof TenantBrandingSchema>;

/** `PUT /api/v1/admin/branding` request body (FR-ADM-07). */
export const UpdateBrandingRequestSchema = Type.Object({
  branding: TenantBrandingSchema,
  whiteLabelEnabled: Type.Optional(Type.Boolean()),
});
export type UpdateBrandingRequest = Static<typeof UpdateBrandingRequestSchema>;

/**
 * `GET /api/v1/public/tenant-branding/{slug}` response (FR-ADM-07, post-QA
 * scope-bug fix Part 2 — login-screen branding). Deliberately minimal: only the
 * fields the login screen needs to render (accent color, logo, display name), and
 * only ever the fields a tenant that has *opted into* white-labeling would want an
 * anonymous visitor to see.
 *
 * Security-critical shape constraint: a nonexistent tenant slug and an existing
 * tenant with `white_label_enabled: false` are **indistinguishable** at this
 * schema's own field level (`whiteLabelEnabled: false` with every other field
 * `null` in both cases) — this endpoint must never let an unauthenticated caller
 * enumerate which tenant slugs exist or which have white-labeling on. See the
 * route handler's doc comment for how this is enforced.
 */
export const PublicTenantBrandingResponseSchema = Type.Object({
  whiteLabelEnabled: Type.Boolean(),
  primaryColor: Type.Union([Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }), Type.Null()]),
  /** A pre-computed white/black foreground pairing for `primaryColor`, using the
   * same shared `checkContrastRatio`-backed algorithm as the Admin Console shell's
   * `--brand-accent-foreground` (`pickForegroundForContrast` in
   * `apps/web/src/lib/build-brand-style-tag.ts`) — computed server-side here so the
   * login screen never needs its own copy of that logic. */
  accentForeground: Type.Union([Type.String({ pattern: "^#[0-9a-fA-F]{6}$" }), Type.Null()]),
  logoUrl: Type.Union([Type.String(), Type.Null()]),
  tenantName: Type.Union([Type.String(), Type.Null()]),
});
export type PublicTenantBrandingResponse = Static<typeof PublicTenantBrandingResponseSchema>;

/** Matches the tenant `slug` shape (`ProvisionTenantRequestSchema`'s own pattern) —
 * reused to validate the `[slug]` dynamic route segment before it ever reaches a
 * database query, on the public/anonymous tenant-branding lookup endpoint. */
export const TENANT_SLUG_PATTERN = /^[a-z0-9-]{1,63}$/;

/** NFR-6 region enum, mirrored from `packages/db/src/schema/enums.ts`'s `regionEnum`. */
export const RegionSchema = Type.Union([Type.Literal("UAE"), Type.Literal("EU"), Type.Literal("US")]);
export type RegionValue = Static<typeof RegionSchema>;

/** LLD §3.3 plan tiers (NFR-4a). */
export const PlanTierSchema = Type.Union([
  Type.Literal("Starter"),
  Type.Literal("Growth"),
  Type.Literal("Enterprise"),
]);
export type PlanTierValue = Static<typeof PlanTierSchema>;

/**
 * Request body for `provisionTenant()` (BL-01 data/domain slice — Phase 1 has no
 * HTTP surface yet, but the application-service input is validated against this same
 * schema so the eventual Phase 3 admin endpoint can reuse it verbatim, per LLD §11.3
 * "validation happens at the edge and only at the edge, with a contracts schema").
 */
export const ProvisionTenantRequestSchema = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  slug: Type.String({ minLength: 1, maxLength: 63, pattern: "^[a-z0-9-]+$" }),
  region: RegionSchema,
  planTier: PlanTierSchema,
  defaultLanguage: Type.String({ minLength: 2, maxLength: 2 }),
  retention: Type.Optional(
    Type.Object({
      transcriptsDays: Type.Optional(Type.Integer()),
      toolPayloadsDays: Type.Optional(Type.Integer()),
      toolMetadataDays: Type.Optional(Type.Integer()),
      piiDays: Type.Optional(Type.Integer()),
      mode: Type.Optional(Type.Literal("indefinite")),
    }),
  ),
});
export type ProvisionTenantRequest = Static<typeof ProvisionTenantRequestSchema>;

/**
 * LLD §3.3 tenant lifecycle status (mirrors `packages/db/src/schema/enums.ts`'s
 * `tenantStatusEnum` — kept in sync by hand, same rationale as `PlanTierSchema`
 * above). Platform Manager console Phase 2 (NFR-11): the first validated write-side
 * use is `updateTenantStatus()`'s HTTP surface — Phase 1 only ever *read* this field
 * (`packages/modules/tenancy/src/application/list-all-tenants.ts` derives its own
 * read-side type straight off the Drizzle schema, since it had no write path to
 * validate against yet).
 */
export const TenantStatusSchema = Type.Union([
  Type.Literal("Active"),
  Type.Literal("Suspended"),
  Type.Literal("Trial"),
]);
export type TenantStatusValue = Static<typeof TenantStatusSchema>;

/** `PATCH /api/internal/ops/tenants/:id/status` request body (NFR-11 Phase 2). */
export const UpdateTenantStatusRequestSchema = Type.Object({
  status: TenantStatusSchema,
});
export type UpdateTenantStatusRequest = Static<typeof UpdateTenantStatusRequestSchema>;

/**
 * `PATCH /api/internal/ops/tenants/:id/plan-tier` request body (NFR-11 Phase 2).
 * Updates ONLY the tenant's plan-tier *label* — never its live
 * `tenant_runtime_quota` row. Re-applying the tier's current quota defaults is a
 * separate, explicit action (`POST .../plan-tier/reseed-quota`, backed by
 * `reseedTenantQuotaFromTier()`) so relabeling never silently clobbers an Enterprise
 * tenant's hand-tuned quota.
 */
export const UpdateTenantPlanTierRequestSchema = Type.Object({
  planTier: PlanTierSchema,
});
export type UpdateTenantPlanTierRequest = Static<typeof UpdateTenantPlanTierRequestSchema>;

/**
 * `PATCH /api/internal/ops/plan-tiers/:tier` request body (NFR-11 Phase 2) — a
 * partial update of one plan tier's editable quota-template fields plus the
 * descriptive `features` field. Every field optional so an operator can change just
 * one without resending the whole row. `features` is explicitly
 * descriptive/forward-looking only (surfaced with that caveat in the Plan Tiers
 * screen's copy) — no feature-gating mechanism exists anywhere else in the codebase
 * to wire it into.
 */
export const UpdatePlanTierDefinitionRequestSchema = Type.Object({
  maxToolCallsPerSecond: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  maxConcurrentConversations: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  maxMcpConnectors: Type.Optional(Type.Union([Type.Integer({ minimum: 0 }), Type.Null()])),
  isDedicatedDatabase: Type.Optional(Type.Boolean()),
  features: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 20 })),
});
export type UpdatePlanTierDefinitionRequest = Static<typeof UpdatePlanTierDefinitionRequestSchema>;

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the platform-enforced
 * maximum a tenant's break-glass consent grant may be time-boxed to, in hours. A
 * tenant may choose any window up to this ceiling; a longer request is rejected
 * outright (`BreakglassGrantExpiryTooLongError`), never silently clamped.
 */
export const BREAKGLASS_MAX_GRANT_HOURS = 24;

/** `POST /api/v1/admin/settings/breakglass-grant` request body — the tenant admin's
 * explicit consent action (FR-ADM-09). `reason` is the tenant's own record of why/what
 * scope they're consenting to, shown back on their own Settings screen and mirrored
 * into their own Audit Log when an operator later activates access under this grant. */
export const CreateBreakglassGrantRequestSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
  expiresInHours: Type.Integer({ minimum: 1, maximum: BREAKGLASS_MAX_GRANT_HOURS }),
});
export type CreateBreakglassGrantRequest = Static<typeof CreateBreakglassGrantRequestSchema>;

/** `POST /api/internal/ops/tenants/:id/breakglass/activate` request body — the
 * operator's own stated diagnostic reason, recorded on both audit trails. */
export const ActivateBreakglassAccessRequestSchema = Type.Object({
  reason: Type.String({ minLength: 1, maxLength: 2000 }),
});
export type ActivateBreakglassAccessRequest = Static<typeof ActivateBreakglassAccessRequestSchema>;
