/** The real `LocaleRepository` — `LocaleSettings` (tenant) joined with `platform.Locale`
 *  (platform) — two separate generated Prisma clients (ADR-0011), joined here in TypeScript
 *  since Prisma cannot express a `@relation` across them. `getPlatformDb()` is safe to call
 *  from an ordinary authenticated backoffice request: `auth-middleware.ts` binds every staff
 *  request's ambient `TenantContext` with `platformScope: "identity"` already (confirmed by
 *  reading that file directly), and `getPlatformDb()`'s own gate only requires *some*
 *  `platformScope` to be set — it does not require the caller to be the identity module
 *  specifically. */
import {
  getPlatformDb,
  getTenantDb,
} from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  LocaleCoverageRow,
  LocaleRepository,
  LocaleRow,
  UpdateLocaleInput,
} from "../../../ports/locale-repository.js";
import { ChannelsError } from "../../../domain/errors.js";

const OPERATION = "channels locale repository";

export class PrismaLocaleRepository implements LocaleRepository {
  async list(): Promise<readonly LocaleRow[]> {
    const tenantDb = getTenantDb(OPERATION);
    const platformDb = getPlatformDb(OPERATION);

    const [settings, locales] = await Promise.all([
      tenantDb.localeSetting.findMany({ orderBy: { localeCode: "asc" } }),
      platformDb.locale.findMany(),
    ]);
    const localeByCode = new Map(locales.map((l) => [l.code, l]));

    return settings.map((setting): LocaleRow => {
      const locale = localeByCode.get(setting.localeCode);
      return {
        localeCode: setting.localeCode,
        englishName: locale?.englishName ?? setting.localeCode,
        nativeName: locale?.nativeName ?? setting.localeCode,
        direction: (locale?.direction as "LTR" | "RTL" | undefined) ?? "LTR",
        isEnabled: setting.isEnabled,
        voiceName: setting.voiceName,
        translatedPercent: Number(
          (setting as unknown as { translatedPercent: number }).translatedPercent ?? 0,
        ),
        translatedStringCount: setting.translatedStringCount,
        totalStringCount: setting.totalStringCount,
        isFallback: setting.isFallback,
      };
    });
  }

  async update(input: UpdateLocaleInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.localeSetting.update({
      where: { localeCode: input.localeCode },
      data: {
        voiceName: input.voiceName,
        isEnabled: input.isEnabled,
        updatedAt: input.now,
      },
    });
  }

  async setFallback(localeCode: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    const target = await db.localeSetting.findUnique({ where: { localeCode } });
    if (!target || !target.isEnabled) {
      // CK_LocaleSettings_fallbackMustBeEnabled would refuse this at the database anyway;
      // checked here first for a clean, named error rather than a raw constraint violation.
      throw new ChannelsError(
        "channels.fallback_locale_required",
        `Locale "${localeCode}" is not enabled and cannot be set as the fallback.`,
      );
    }
    // Clear the previous holder(s) BEFORE setting the new one — the same ordering
    // `prisma-theme-repository.ts`'s own filtered-unique-index precedent uses for
    // UQ_Skins_tenantDefault, confirmed live there to avoid a transient double-true state
    // SQL Server's filtered index checks after each statement, not only at commit.
    await db.$transaction([
      db.localeSetting.updateMany({
        where: { isFallback: true, localeCode: { not: localeCode } },
        data: { isFallback: false, updatedAt: now },
      }),
      db.localeSetting.update({
        where: { localeCode },
        data: { isFallback: true, updatedAt: now },
      }),
    ]);
  }

  async coverageFor(localeCode: string): Promise<readonly LocaleCoverageRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.translationString.findMany({
      where: { localeCode },
      select: { stringKey: true, state: true },
    });
    return rows.map((row) => ({
      stringKey: row.stringKey,
      state: row.state as LocaleCoverageRow["state"],
    }));
  }
}
