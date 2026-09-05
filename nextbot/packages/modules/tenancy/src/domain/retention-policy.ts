import { RetentionPeriodInvalidError } from "@nextbot/contracts";

/** Sentinel value meaning "retain indefinitely" (LLD §3.3). */
export const INDEFINITE_RETENTION = -1;

/**
 * Validates one retention-period field per FR-ADM-06: blank/0/negative (other than the
 * `-1` "Indefinite" sentinel) is rejected. `-1` is only accepted when the caller
 * explicitly opted into indefinite mode for that field (`explicitIndefinite`) — a
 * bare `-1` sent without that opt-in is treated the same as any other invalid value,
 * so a client cannot smuggle "indefinite" in by accident.
 *
 * Pure function, no I/O — belongs in `domain/` per LLD §2.2.
 */
export function validateRetentionDays(
  fieldPath: string,
  value: number | undefined,
  explicitIndefinite: boolean,
): number {
  if (explicitIndefinite) {
    return INDEFINITE_RETENTION;
  }
  if (value === undefined || value === null || !Number.isInteger(value) || value <= 0) {
    throw new RetentionPeriodInvalidError(fieldPath);
  }
  return value;
}

/**
 * Phase 17 (BL-10) retention purge sweeper's pure decision function: given a
 * retention-days value (as stored in `tenant_data_policy`, `-1` meaning
 * Indefinite) and the current time, returns the cutoff date rows older than
 * should be purged, or `null` if this tenant/category is exempt (Indefinite).
 * Pure, no I/O — the sweeper (`apps/worker`) supplies the actual DB delete.
 */
export function computePurgeCutoff(retentionDays: number, now: Date = new Date()): Date | null {
  if (retentionDays === INDEFINITE_RETENTION) return null;
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}
