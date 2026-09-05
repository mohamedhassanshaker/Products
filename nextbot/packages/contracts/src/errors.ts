/**
 * Base class every module's domain errors extend (LLD §11.2). `toProblem()`
 * (added once an HTTP surface exists, Phase 2+) maps these to RFC 9457
 * `application/problem+json` bodies; an unmapped throw becomes a generic
 * `500 INTERNAL_ERROR` with the real message logged server-side only.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly httpStatus: number;
  readonly fields?: Array<{ path: string; code: string; message: string }>;

  constructor(message: string, fields?: Array<{ path: string; code: string; message: string }>) {
    super(message);
    this.name = new.target.name;
    this.fields = fields;
  }
}

/** FR-ADM-06 — blank/0 retention rejected; `-1` only settable via explicit indefinite mode. */
export class RetentionPeriodInvalidError extends DomainError {
  readonly code = "RETENTION_PERIOD_INVALID";
  readonly httpStatus = 422;
  constructor(field: string) {
    super(`Set a retention period greater than 0 days, or choose 'Indefinite' explicitly.`, [
      { path: field, code: "RETENTION_PERIOD_INVALID", message: "Retention period must be > 0 days, or -1 for Indefinite." },
    ]);
  }
}

/** Raised when a tenant `name`/`slug` collides with an existing tenant. */
export class TenantAlreadyExistsError extends DomainError {
  readonly code = "TENANT_ALREADY_EXISTS";
  readonly httpStatus = 409;
  constructor(field: "name" | "slug", value: string) {
    super(`A tenant with ${field} '${value}' already exists.`);
  }
}

/**
 * NFR-4/NFR-4a (Phase 18, BL-11): a tenant has exceeded one of its live
 * `tenant_runtime_quota` limits (concurrent runs, tokens/min, tool-calls/sec). Kept
 * distinct from a generic 500/429 so the caller can render "you've hit your plan's
 * limit" rather than a generic error, per NFR-4a's explicit requirement.
 */
export class QuotaExceededError extends DomainError {
  readonly code = "QUOTA_EXCEEDED";
  readonly httpStatus = 429;
  constructor(public readonly quotaKind: "ConcurrentRuns" | "TokensPerMinute" | "ToolCallsPerSecond") {
    super(`Quota exceeded for your plan (${quotaKind}). Please try again shortly or contact your administrator to increase this limit.`);
  }
}

/**
 * FR-ADM-07: a brand color fails WCAG 2.2 AA contrast against the surface it's
 * intended for. Blocks saving as the tenant's *default* profile outright — the
 * spec's "save anyway" override exists only for a host-page-level widget override,
 * a surface this codebase's Admin Console screen does not configure, so there is no
 * override path here at all.
 */
export class BrandingContrastInsufficientError extends DomainError {
  readonly code = "BRANDING_CONTRAST_INSUFFICIENT";
  readonly httpStatus = 422;
  constructor(field: string, surface: string) {
    super(`This color doesn't meet accessibility contrast requirements against ${surface}.`, [
      { path: field, code: "BRANDING_CONTRAST_INSUFFICIENT", message: `Doesn't meet WCAG AA contrast against ${surface}.` },
    ]);
  }
}

/** Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — a webhook target URL
 * (or an OTel/SIEM export endpoint URL, which reuses this same class) is not a
 * well-formed `https://` URL. Rejected at save time — never silently accepted and
 * left to fail on the first real delivery attempt. */
export class WebhookTargetUrlInvalidError extends DomainError {
  readonly code = "WEBHOOK_TARGET_URL_INVALID";
  readonly httpStatus = 422;
  constructor(field: string) {
    super("The target URL must be a well-formed https:// URL.", [
      { path: field, code: "WEBHOOK_TARGET_URL_INVALID", message: "Must be a well-formed https:// URL." },
    ]);
  }
}

/** A subscription/config id that doesn't resolve within the caller's own tenant
 * (never distinguished from "belongs to another tenant" — same fail-closed,
 * non-enumerable shape as every other `*NotFoundError` in this codebase). */
export class WebhookSubscriptionNotFoundError extends DomainError {
  readonly code = "WEBHOOK_SUBSCRIPTION_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("Webhook subscription not found.");
  }
}

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — the spec's own named
 * hard requirement: an operator access request with no active (unexpired, unrevoked)
 * tenant-side consent grant is denied at the platform level, fail-closed, regardless
 * of the operator's own role/token validity. `reason` is recorded in the platform
 * audit trail's `details` for operator-side accountability, never shown to the tenant.
 */
export class BreakglassAccessDeniedError extends DomainError {
  readonly code = "BREAKGLASS_ACCESS_DENIED";
  readonly httpStatus = 403;
  constructor(public readonly reason: "no_grant" | "revoked" | "expired") {
    super("No active break-glass consent grant exists for this tenant.");
  }
}

/** A tenant admin tried to create a new break-glass grant while one is already
 * active — they must explicitly revoke it first, so "the active grant" is always
 * unambiguous both for the tenant's own UI and for the platform-ops fail-closed
 * check. */
export class BreakglassGrantAlreadyActiveError extends DomainError {
  readonly code = "BREAKGLASS_GRANT_ALREADY_ACTIVE";
  readonly httpStatus = 409;
  constructor() {
    super("A break-glass consent grant is already active for this tenant. Revoke it before creating a new one.");
  }
}

/** A requested grant expiry exceeds the platform-enforced maximum
 * (`BREAKGLASS_MAX_GRANT_HOURS`) — rejected outright rather than silently clamped, so
 * a tenant is never misled into believing they granted less exposure than an accepted
 * request actually recorded. */
export class BreakglassGrantExpiryTooLongError extends DomainError {
  readonly code = "BREAKGLASS_GRANT_EXPIRY_TOO_LONG";
  readonly httpStatus = 422;
  constructor(maxHours: number) {
    super(`Grant expiry cannot exceed ${maxHours} hours from now.`, [
      { path: "expiresInHours", code: "BREAKGLASS_GRANT_EXPIRY_TOO_LONG", message: `Must be between 1 and ${maxHours} hours.` },
    ]);
  }
}
