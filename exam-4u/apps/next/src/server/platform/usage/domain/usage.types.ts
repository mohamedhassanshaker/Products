/** A feature's reset cadence, mirroring `FeatureEntity.resetPeriod` (FR-PKG-1). */
export type ResetPeriod = 'NONE' | 'DAILY' | 'MONTHLY';

/**
 * Derives the current period key for a feature's reset cadence (LLD §9.5). Deliberately **derived,
 * never stored** — `tenant_feature_usage.period_key` is just a plain `VARCHAR`, so the mapping from
 * "now" to a period key lives in exactly one place (this function), preventing drift between the
 * value written when incrementing and the value read when checking the limit. Ported verbatim from
 * `legacy/api/src/platform/usage/domain/usage.types.ts`.
 *
 * - `MONTHLY` → `'YYYY-MM'` (UTC) — resets on the 1st of the next month.
 * - `DAILY` → `'YYYY-MM-DD'` (UTC) — resets at the next UTC midnight.
 * - `NONE` → the literal `'lifetime'` — a cap that never resets (FR-PKG-1).
 */
export function derivePeriodKey(resetPeriod: ResetPeriod, now: Date = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  switch (resetPeriod) {
    case 'MONTHLY':
      return `${year}-${month}`;
    case 'DAILY':
      return `${year}-${month}-${day}`;
    case 'NONE':
      return 'lifetime';
  }
}

/**
 * When the *current* period resets (UTC), for the `FEATURE_LIMIT_REACHED` response's `resetsAt`
 * field (FR-PKG-5: "identifies... when the current period resets, so the caller/UI can present an
 * actionable upgrade prompt"). `null` for `NONE` — a lifetime cap never resets, so there is nothing
 * to report. Ported verbatim from `legacy/api/src/platform/usage/domain/usage.types.ts`.
 */
export function deriveResetsAt(resetPeriod: ResetPeriod, now: Date = new Date()): Date | null {
  switch (resetPeriod) {
    case 'MONTHLY':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0));
    case 'DAILY':
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0, 0));
    case 'NONE':
      return null;
  }
}

/** One row of the self-service usage/quota read endpoint's response (FR-PKG-5: "current usage and
 * remaining quota... readable by that tenant's Admin"). */
export interface FeatureUsageSnapshotItem {
  featureKey: string;
  featureName: string;
  unit: string;
  enabled: boolean;
  /** `null` = unlimited. */
  limit: number | null;
  used: number;
  /** `null` if `limit` is `null` (unlimited) or the feature is disabled. */
  remaining: number | null;
  resetsAt: string | null;
}
