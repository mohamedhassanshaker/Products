/**
 * `PrivacyConfigs` (singleton) — B14 tab 4. Pure domain logic: retention/residency
 * vocabulary transcribed verbatim from the real `CK_PrivacyConfigs_*` constraints
 * (`prisma/sql/001_constraints.sql`), never guessed from the wireframe's English labels —
 * this project's own standing discipline after `TR_RolePermissions_protectSuperAdmin`'s
 * silent snake_case/colon-case drift (`tasks/lessons.md`).
 *
 * There is deliberately no transaction-retention option anywhere in this vocabulary —
 * `docs/data-model.md` §4.13's own words: "a setting that does not exist cannot be
 * misconfigured, and no screen can offer it." `Transactions.retentionExpiresAt` is a
 * separate, SQL-computed `DATEADD(YEAR, 7, initiatedAt)` column this module never writes.
 */

export const TRANSCRIPT_RETENTIONS = ["Days30", "Days90", "Year1", "Year7"] as const;
export type TranscriptRetention = (typeof TRANSCRIPT_RETENTIONS)[number];

export const DATA_RESIDENCIES = ["UaeSharjahDc", "UaeDubaiDc", "RegionFlexible"] as const;
export type DataResidency = (typeof DATA_RESIDENCIES)[number];

export const DEFAULT_TRANSCRIPT_RETENTION: TranscriptRetention = "Days90";
export const DEFAULT_DATA_RESIDENCY: DataResidency = "UaeSharjahDc";

/** Calendar days for each retention window — 365/2555 (7 * 365), matching
 *  `docs/data-model.md` §10.5's own sweep formula exactly (`Year7` = 2555 days, not a
 *  leap-aware year count — the doc's own worked formula, transcribed verbatim). */
const RETENTION_DAYS: Readonly<Record<TranscriptRetention, number>> = {
  Days30: 30,
  Days90: 90,
  Year1: 365,
  Year7: 2555,
};

export function retentionDays(retention: TranscriptRetention): number {
  return RETENTION_DAYS[retention];
}

/** The cutoff a retention sweep purges *below* — any row whose own stamped
 *  `retentionExpiresAt` (or, for a row with no such column, `createdAt + retentionDays`)
 *  is at or before `now` is in scope. Exposed as a pure function so `RunRetentionSweep`'s
 *  own date arithmetic is unit-testable without a database. */
export function retentionCutoff(retention: TranscriptRetention, now: Date): Date {
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays(retention));
  return cutoff;
}

export function isValidTranscriptRetention(value: string): value is TranscriptRetention {
  return (TRANSCRIPT_RETENTIONS as readonly string[]).includes(value);
}

export function isValidDataResidency(value: string): value is DataResidency {
  return (DATA_RESIDENCIES as readonly string[]).includes(value);
}

export class PrivacyConfigNotFoundError extends Error {
  readonly code = "governance.privacy_config_not_found";
  constructor() {
    super(
      "PrivacyConfigs has no singleton row for this tenant — tenant provisioning should " +
        "have seeded one; this is a real gap to fix at the source, not to default around.",
    );
    this.name = "PrivacyConfigNotFoundError";
  }
}
