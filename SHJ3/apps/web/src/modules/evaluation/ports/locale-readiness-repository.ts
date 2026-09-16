/**
 * FR-EVAL-09's join — `AgentLocaleBinding` (which locales a version claims to serve) against
 * `LocaleSettings.translatedPercent` (§4.10's computed, persisted column).
 *
 * **Correction against this feature's own brief**: `LocaleSetting` lives in
 * `prisma/tenant/schema.prisma` (confirmed by direct read — `model LocaleSetting` at that
 * file's own §4.10 section), not `prisma/platform/schema.prisma` as originally assumed. It
 * is read via `getTenantDb()`, the SAME client as every other repository in this module —
 * there is no cross-client join here, unlike `platform.Locale` (a genuinely different
 * client, referenced only by `localeCode` per `LocaleSetting`'s own doc comment, and not
 * needed by this port at all since `translatedPercent` lives entirely on the tenant side).
 * `translatedPercent` itself is a DB computed column with no corresponding Prisma model
 * field (§4.10: "COMPUTED PERSISTED... it isn't even in the Prisma model") — the adapter
 * reads it via `$queryRaw`, not the Prisma Client API.
 */

export interface BoundLocaleReadinessRow {
  readonly localeCode: string;
  readonly translatedPercent: number;
}

export interface LocaleReadinessRepository {
  /** Every locale `AgentLocaleBinding` names for this version, joined to its current
   *  `translatedPercent`. */
  listForVersion(agentVersionId: string): Promise<readonly BoundLocaleReadinessRow[]>;
}
