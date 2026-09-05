import { DomainError } from '@/server/common/errors/domain-error';

/**
 * Thrown when the resolved effective package (own package, or the `FALLBACK_PACKAGE_KEY` package for
 * a `CANCELED` subscription) does not enable the requested feature at all — either because the
 * `(package, feature)` row is absent (default-deny, FR-PKG-3) or explicitly `enabled=false`, or
 * because there is no effective package to resolve in the first place (no subscription, or a
 * `CANCELED` subscription whose fallback package doesn't exist — FR-PKG-4/FR-PKG-6's fail-closed
 * rules). Ported verbatim from `legacy/api/src/platform/usage/domain/errors.ts`. 403 (see
 * `@examland/contracts`' `ERROR_CODE_HTTP_STATUS['FEATURE_NOT_ENABLED']`).
 */
export class FeatureNotEnabledError extends DomainError {
  constructor(featureKey: string) {
    super('FEATURE_NOT_ENABLED', `The feature '${featureKey}' is not enabled on the current plan.`);
  }
}

/**
 * Thrown when the tenant's package limit for a feature+period has already been reached (FR-PKG-5).
 * 429 (see `@examland/contracts`' `ERROR_CODE_HTTP_STATUS['FEATURE_LIMIT_REACHED']`), carrying the
 * exact `{feature, limit, resetsAt}` detail shape FR-PKG-5 requires so the caller/UI can present an
 * actionable upgrade prompt. Ported verbatim from `legacy/api/src/platform/usage/domain/errors.ts`.
 */
export class FeatureLimitReachedError extends DomainError {
  constructor(featureKey: string, limit: number, resetsAt: Date | null) {
    super('FEATURE_LIMIT_REACHED', `The usage limit for '${featureKey}' has been reached for the current period.`, {
      feature: featureKey,
      limit,
      resetsAt: resetsAt ? resetsAt.toISOString() : null,
    });
  }
}
