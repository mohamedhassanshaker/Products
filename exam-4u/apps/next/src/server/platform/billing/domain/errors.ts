import { DomainError } from '@/server/common/errors/domain-error';

/**
 * `platform.feature`/`platform.package` catalog CRUD errors (FR-PKG-7, migration plan Phase 2
 * sub-slice "2b") — ported verbatim from legacy's two separate `domain/errors.ts` files
 * (`legacy/api/src/platform/features/domain/errors.ts` and
 * `legacy/api/src/platform/packages/domain/errors.ts`), consolidated into this one file because both
 * catalog concepts already share one `server/platform/billing` module in this app (Phase 1a's own
 * "Decisions made" — see that dispatch's plan section for why packages/features/subscriptions live
 * together here rather than split per legacy's separate-NestJS-module granularity).
 */

// ── Feature errors (FR-PKG-7) ──────────────────────────────────────────────────────────────────────

/** `POST /platform/features` / a key-change on `PATCH .../:id` collided with an existing feature's
 * `key` (`uq_feature_key`). */
export class FeatureKeyExistsError extends DomainError {
  constructor() {
    super('FEATURE_KEY_EXISTS', 'A feature with this key already exists.');
  }
}

/** A `PATCH /platform/features/:id` attempted to change `key` on a feature already referenced by at
 * least one `package_feature` row. The key is immutable once referenced so that a future
 * feature-usage-enforcement phase's in-flight resolution-by-key can never be silently redirected to a
 * different feature mid-flight. */
export class FeatureKeyImmutableError extends DomainError {
  constructor() {
    super('FEATURE_KEY_IMMUTABLE', "This feature's key can't be changed because it's used by one or more packages.");
  }
}

/** `DELETE /platform/features/:id` attempted on a feature still referenced by at least one
 * `package_feature` row (`fk_pf_feature ... ON DELETE RESTRICT` is the DB-level backstop; this is the
 * primary, documented-error-code guard). */
export class FeatureInUseError extends DomainError {
  constructor() {
    super(
      'FEATURE_IN_USE',
      "This feature is used by one or more packages and can't be deleted. Remove it from those " +
        'packages’ feature configuration first, then try again.',
    );
  }
}

/** Thrown when a feature id does not resolve to any `platform.feature` row — either a direct lookup
 * (edit/delete screens) or, cross-module, `PackagesService.replaceFeatures` validating every
 * `featureId` in an atomic `PUT /platform/packages/:id/features` payload (FR-PKG-3). */
export class FeatureNotFoundError extends DomainError {
  constructor() {
    super('FEATURE_NOT_FOUND', 'No such feature.');
  }
}

// ── Package errors (FR-PKG-7) ──────────────────────────────────────────────────────────────────────

/** `POST /platform/packages` / `PATCH .../:id` collided with an existing package's `key`
 * (`uq_package_key`). */
export class PackageKeyExistsError extends DomainError {
  constructor() {
    super('PACKAGE_KEY_EXISTS', 'A package with this key already exists.');
  }
}

/** Thrown when a package id does not resolve to any `platform.package` row — the edit/feature-
 * configuration screens' existence check, and (a later sub-dispatch) the tenant-subscription
 * reassignment endpoint's target-package validation (FR-PKG-4). */
export class PackageNotFoundError extends DomainError {
  constructor() {
    super('PACKAGE_NOT_FOUND', 'No such package.');
  }
}

/** A tenant-subscription reassignment (or a new Stripe Checkout Session) named an `isActive: false`
 * package as its target. An inactive package can still serve tenants already on it (unaffected by
 * this check — only *new* assignment is blocked). Thrown by both `BillingCheckoutService.
 * createCheckoutSession` and `SubscriptionAdminService.reassign` (Phase 2 sub-slice "2c"). */
export class PackageInactiveError extends DomainError {
  constructor() {
    super('PACKAGE_INACTIVE', 'This package is inactive and can no longer be newly assigned to a tenant.');
  }
}

// ── Billing/Stripe errors (FR-PKG-6, migration plan Phase 2 sub-slice "2c") ────────────────────────
// Ported verbatim from `legacy/api/src/platform/billing/domain/errors.ts`.

/**
 * `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` are empty for this deployment (`env.schema.ts`: "Empty
 * ⇒ billing endpoints return `BILLING_NOT_CONFIGURED` 503"). Thrown by `BillingCheckoutService`
 * before ever calling out to the gateway — a Platform Admin gets an explicit, actionable 503 rather
 * than a gateway-level failure.
 */
export class BillingNotConfiguredError extends DomainError {
  constructor() {
    super('BILLING_NOT_CONFIGURED', 'Billing is not configured for this deployment.');
  }
}

/**
 * A webhook request failed cryptographic signature verification (bad/missing signature, wrong
 * secret, or a tampered/expired payload). **Security-critical**: the message is intentionally
 * generic and carries no `details` — it must never reveal *which* check failed (missing header vs.
 * bad signature vs. clock-skew/replay-window), since this is an unauthenticated, internet-facing
 * endpoint and any more specific message would help an attacker iterate toward a forged payload.
 */
export class WebhookSignatureInvalidError extends DomainError {
  constructor() {
    super('WEBHOOK_SIGNATURE_INVALID', 'Invalid webhook request.');
  }
}
