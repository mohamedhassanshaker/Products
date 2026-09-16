/**
 * The real `ThemeRepository` — `<tenant>.TenantBranding`, `<tenant>.UserThemePreference`
 * and their related `Skin`/`TokenSet` rows (`prisma/tenant/schema.prisma`).
 *
 * Reached exclusively through `getTenantDb()` (ADR-0002 rule 3) — every query below
 * resolves inside the calling tenant's own schema, so this adapter cannot express a
 * cross-tenant read even by mistake. No `getPlatformDb()` call anywhere in this file:
 * the system tier is `@shj3/tokens`' static export, read by the application layer
 * directly (see `ThemeRepository`'s doc comment for the real reason).
 *
 * ## The SkinEditor write path (2026-09-09)
 *
 * Every write below follows the array form of `db.$transaction([...])` that
 * `PrismaSystemSkinSeeder` already established in this module, rather than Prisma's
 * interactive `$transaction(async (tx) => ...)` form — no adapter anywhere in this
 * codebase uses the interactive form yet, and nothing here genuinely needs it: the
 * one read-then-write dependency (`saveTenantAppearance`'s update branch needs the
 * skin's CURRENT `lightTokenSetId`/`darkTokenSetId` before it can create the
 * replacement pair) is resolved with a plain read *before* the transaction array is
 * built, exactly the way `newUlid()`-minted ids are computed before the array below
 * that references them. A concurrent edit to the same tenant skin by two admins at
 * once is a low-probability, low-stakes race for this feature (last write wins, no
 * data corruption, no cross-tenant exposure) — not a case worth introducing this
 * codebase's first interactive transaction to close.
 *
 * A `TokenSet` is never mutated in place once created: an edit creates a NEW
 * `TokenSet` pair via the lineage FK (`parentTokenSetId`) and soft-deletes the pair
 * it replaces, so a skin's colour history stays reconstructable — the schema already
 * had this lineage relation built and unused; using it is the more architecturally
 * consistent choice than overwriting `tokensJson` in place.
 *
 * `Skin.isTenantDefault` is treated as a flag this adapter keeps in sync with
 * `TenantBranding.activeSkinId` — true on exactly the currently-active skin, false on
 * every sibling — rather than a second, independently-set source of truth. The
 * schema's own `UQ_Skins_tenantDefault` filtered unique index (at most one row WHERE
 * `isTenantDefault = 1`) is what makes "flip the old one off, the new one on, in the
 * same transaction" a real constraint the write must satisfy, not just a convention.
 */

import { SKIN_SCHEMA_VERSION, type ContrastReport, type SemanticColorTokens } from "@shj3/tokens";
import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  CreateTenantSkinInput,
  SaveBrandAssetInput,
  SaveBrandAssetResult,
  SaveTenantAppearanceInput,
  TenantBrandingScalars,
  TenantBrandingSnapshot,
  TenantSkinDeletionResult,
  TenantSkinDetail,
  TenantSkinSummary,
  ThemeRepository,
  UserPreferenceScalarsInput,
  UserPreferenceSnapshot,
} from "../../../ports/theme-repository.js";
import type { DbDensity, DbDirection, DbMode } from "../../../domain/theme.js";
import type { BrandAssetKind } from "../../../domain/brand-asset.js";

const OPERATION = "theme resolution";
const SKIN_OPERATION = "skin management";

function parseColorTokens(tokensJson: string): SemanticColorTokens {
  // TokenSets.tokensJson is guarded by CK_TokenSets_contrastGate at the database
  // (a row cannot exist without a contrastValidatedAt, which only a validated save
  // produces), so parsing is decoding an already-constrained column, not
  // re-validating untrusted input here.
  return JSON.parse(tokensJson) as SemanticColorTokens;
}

/**
 * Two `TokenSet.create()` calls for one skin's light+dark pair, sharing every field
 * except mode/tokens/lineage-parent — factored so `saveTenantAppearance` (create
 * branch) and `createTenantSkin` cannot drift on what a "new tenant token set" looks
 * like. `kind: "TenantSkin"` uniformly: a personal skin is not a structurally
 * distinct row, only a `UserThemePreference.skinId` pointer at an ordinary tenant
 * skin (see `ports/theme-repository.ts`'s own doc comment on `applyUserSkin`), so
 * `"UserSkin"` (the third value the column comment documents) has no real writer in
 * this build.
 */
function buildTokenSetCreateData(input: {
  id: string;
  namePrefix: string;
  mode: "Light" | "Dark";
  tokens: SemanticColorTokens;
  contrastReport: ContrastReport;
  parentTokenSetId?: string;
  now: Date;
}) {
  return {
    id: input.id,
    name: `${input.namePrefix} (${input.mode})`,
    kind: "TenantSkin",
    mode: input.mode,
    schemaVersion: SKIN_SCHEMA_VERSION,
    tokensJson: JSON.stringify(input.tokens),
    // Conditional spread, not `parentTokenSetId: input.parentTokenSetId` — under this
    // project's `exactOptionalPropertyTypes`, Prisma's generated create-input type
    // (no `| undefined` in its own optional-field declaration) rejects an EXPLICIT
    // `undefined`, only an OMITTED key (dropdown-menu.tsx's `checked` prop hits the
    // identical shape and documents the same fix).
    ...(input.parentTokenSetId !== undefined ? { parentTokenSetId: input.parentTokenSetId } : {}),
    contrastValidatedAt: input.now,
    contrastReportJson: JSON.stringify(input.contrastReport),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

/** `TenantBranding.upsert`'s shared shape — both `saveTenantAppearance` and
 *  `applyExistingTenantSkin` write every scalar column together on `create`
 *  (§9.2 rule 1) but only `activeSkinId`/audit columns on `update` when a row
 *  already exists (its other scalars were set by whichever save put them there). */
function tenantBrandingUpsertArgs(
  activeSkinId: string,
  scalars: TenantBrandingScalars,
  updatedByStaffUserId: string,
  now: Date,
  updateScalarsToo: boolean,
) {
  return {
    where: { singletonKey: 1 },
    create: {
      id: newUlid(now),
      singletonKey: 1,
      activeSkinId,
      appTitle: scalars.appTitle,
      defaultMode: scalars.defaultMode,
      defaultDirection: scalars.defaultDirection,
      density: scalars.density,
      fontSize: scalars.fontSize,
      shadowDepth: scalars.shadowDepth,
      sidebarStyle: scalars.sidebarStyle,
      whiteLabelEnabled: false,
      updatedByStaffUserId,
      createdAt: now,
      updatedAt: now,
    },
    update: updateScalarsToo
      ? {
          activeSkinId,
          appTitle: scalars.appTitle,
          defaultMode: scalars.defaultMode,
          defaultDirection: scalars.defaultDirection,
          density: scalars.density,
          fontSize: scalars.fontSize,
          shadowDepth: scalars.shadowDepth,
          sidebarStyle: scalars.sidebarStyle,
          updatedByStaffUserId,
          updatedAt: now,
        }
      : { activeSkinId, updatedByStaffUserId, updatedAt: now },
  };
}

/**
 * `TR_Skins_blockActiveDeletion` / `TR_Skins_blockSystemDelete` refuse the write at
 * the database with a custom `THROW` (error 51021 / 51020) rather than a constraint
 * Prisma specifically recognises (unlike a unique or FK violation, which Prisma maps
 * to a stable `P2002`/`P2003` code) — there is no live database in this environment
 * to observe exactly how the query engine wraps a raw driver error for a case it does
 * not have a specific mapping for, so this matches on the trigger's own hard-coded
 * message text (stable, because this codebase owns both ends) rather than trusting
 * an unobserved Prisma error `code`. Deliberately over-inclusive rather than
 * under-inclusive: a false negative here would let a blocked delete masquerade as a
 * generic 500 instead of the legible, structured result the brief requires.
 */
/** Matches `prisma-campaign-repository.ts`'s identical, established helper — a plain duck-typed check rather than importing the generated client's error class, since every caller here only needs the one field. */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && (error as { code?: string }).code === "P2002"
  );
}

function blockingTriggerReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (error.message.includes("currently applied as active tenant branding")) {
    return "This skin is currently applied as your organisation's active appearance. Apply a different skin before deleting it.";
  }
  if (error.message.includes("A system skin cannot be")) {
    return "This is a system-provided skin and cannot be deleted.";
  }
  return null;
}

export class PrismaThemeRepository implements ThemeRepository {
  async readTenantBranding(): Promise<TenantBrandingSnapshot | null> {
    const db = getTenantDb(OPERATION);
    // TenantBranding is a singleton (UQ_TenantBrandings_singleton, singletonKey = 1),
    // so findFirst and findUnique-by-singletonKey are equivalent; findFirst avoids
    // depending on the generated client's exact unique-input shape for that column.
    const row = await db.tenantBranding.findFirst({
      include: {
        activeSkin: { include: { lightTokenSet: true, darkTokenSet: true } },
        logoLightAsset: { select: { storageRef: true } },
        logoDarkAsset: { select: { storageRef: true } },
        faviconAsset: { select: { storageRef: true } },
      },
    });
    if (!row) return null;

    return {
      appTitle: row.appTitle,
      defaultMode: row.defaultMode as DbMode,
      defaultDirection: row.defaultDirection as DbDirection,
      density: row.density as DbDensity,
      fontSize: row.fontSize,
      shadowDepth: row.shadowDepth,
      sidebarStyle: row.sidebarStyle,
      activeSkinColors: {
        light: parseColorTokens(row.activeSkin.lightTokenSet.tokensJson),
        dark: parseColorTokens(row.activeSkin.darkTokenSet.tokensJson),
      },
      // `BrandAssets.storageRef` IS the public URL in this implementation (this
      // adapter's `LocalBrandAssetStorage` sibling's own doc comment explains why
      // "storage reference" and "public URL" are deliberately the same value here).
      logoLightUrl: row.logoLightAsset?.storageRef ?? null,
      logoDarkUrl: row.logoDarkAsset?.storageRef ?? null,
      faviconUrl: row.faviconAsset?.storageRef ?? null,
    };
  }

  async readUserPreference(staffUserId: string): Promise<UserPreferenceSnapshot | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.userThemePreference.findUnique({
      where: { staffUserId },
      include: { skin: { include: { lightTokenSet: true, darkTokenSet: true } } },
    });
    if (!row) return null;

    // A dangling reference (the user's personally-selected skin was soft-deleted)
    // defers to the tenant tier rather than erroring — see this table's own doc
    // comment in prisma/tenant/schema.prisma for why no DB trigger prevents this.
    const personalSkinColors =
      row.skin && row.skin.deletedAt === null
        ? {
            light: parseColorTokens(row.skin.lightTokenSet.tokensJson),
            dark: parseColorTokens(row.skin.darkTokenSet.tokensJson),
          }
        : null;

    return {
      mode: (row.mode as DbMode | null) ?? null,
      density: (row.density as DbDensity | null) ?? null,
      direction: (row.direction as DbDirection | null) ?? null,
      fontSize: row.fontSize,
      reducedMotion: row.reducedMotion,
      personalSkinColors,
    };
  }

  async listTenantSkins(): Promise<readonly TenantSkinSummary[]> {
    const db = getTenantDb(SKIN_OPERATION);
    const [rows, branding] = await Promise.all([
      db.skin.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
      db.tenantBranding.findFirst({ select: { activeSkinId: true } }),
    ]);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: row.id === branding?.activeSkinId,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  async readTenantSkinDetail(skinId: string): Promise<TenantSkinDetail | null> {
    const db = getTenantDb(SKIN_OPERATION);
    const [row, branding] = await Promise.all([
      db.skin.findFirst({
        where: { id: skinId, deletedAt: null },
        include: { lightTokenSet: true, darkTokenSet: true },
      }),
      db.tenantBranding.findFirst({ select: { activeSkinId: true } }),
    ]);
    if (!row) return null;
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      isActive: row.id === branding?.activeSkinId,
      updatedAt: row.updatedAt.toISOString(),
      light: parseColorTokens(row.lightTokenSet.tokensJson),
      dark: parseColorTokens(row.darkTokenSet.tokensJson),
    };
  }

  async saveTenantAppearance(
    input: SaveTenantAppearanceInput,
  ): Promise<{ ok: true; skinId: string } | { ok: false; reason: "nameTaken" }> {
    const db = getTenantDb(SKIN_OPERATION);
    const now = new Date();

    if (input.editingSkinId === null) {
      const lightId = newUlid(now);
      const darkId = newUlid(new Date(now.getTime() + 1));
      const skinId = newUlid(new Date(now.getTime() + 2));

      try {
        await db.$transaction([
          db.tokenSet.create({
            data: buildTokenSetCreateData({
              id: lightId,
              namePrefix: input.skinName,
              mode: "Light",
              tokens: input.light,
              contrastReport: input.lightContrastReport,
              now,
            }),
          }),
          db.tokenSet.create({
            data: buildTokenSetCreateData({
              id: darkId,
              namePrefix: input.skinName,
              mode: "Dark",
              tokens: input.dark,
              contrastReport: input.darkContrastReport,
              now,
            }),
          }),
          // Unsetting every OTHER skin's flag BEFORE creating this one is not
          // stylistic — it is the only order that does not trip
          // UQ_Skins_tenantDefault (WHERE isTenantDefault = 1, at most one row).
          // SQL Server checks a filtered unique index after EACH statement in a
          // transaction, not only at commit, so creating this skin as
          // isTenantDefault: true BEFORE clearing the previous holder would
          // transiently leave two rows satisfying the index and fail with P2002 —
          // confirmed for real, not reasoned about, by the live-infrastructure
          // proof this wave ran against an actual SQL Server (see the review
          // entry in tasks/todo.md for the exact failure this order once produced).
          db.skin.updateMany({
            where: { isTenantDefault: true, id: { not: skinId } },
            data: { isTenantDefault: false },
          }),
          db.skin.create({
            data: {
              id: skinId,
              name: input.skinName,
              description: input.skinDescription,
              lightTokenSetId: lightId,
              darkTokenSetId: darkId,
              isSystem: false,
              isTenantDefault: true,
              status: "Published",
              exportSchemaVersion: SKIN_SCHEMA_VERSION,
              createdByStaffUserId: input.updatedByStaffUserId,
              createdAt: now,
              updatedAt: now,
            },
          }),
          db.tenantBranding.upsert(
            tenantBrandingUpsertArgs(skinId, input.branding, input.updatedByStaffUserId, now, true),
          ),
        ]);
      } catch (error) {
        if (isUniqueConstraintViolation(error)) return { ok: false, reason: "nameTaken" };
        throw error;
      }

      return { ok: true, skinId };
    }

    // Update branch: read the skin's CURRENT token-set pair before the transaction —
    // see the module comment for why this read sits outside $transaction rather than
    // using Prisma's interactive form.
    const existing = await db.skin.findFirstOrThrow({
      where: { id: input.editingSkinId, deletedAt: null },
    });
    const newLightId = newUlid(now);
    const newDarkId = newUlid(new Date(now.getTime() + 1));

    try {
      await db.$transaction([
        db.tokenSet.create({
          data: buildTokenSetCreateData({
            id: newLightId,
            namePrefix: input.skinName,
            mode: "Light",
            tokens: input.light,
            contrastReport: input.lightContrastReport,
            parentTokenSetId: existing.lightTokenSetId,
            now,
          }),
        }),
        db.tokenSet.create({
          data: buildTokenSetCreateData({
            id: newDarkId,
            namePrefix: input.skinName,
            mode: "Dark",
            tokens: input.dark,
            contrastReport: input.darkContrastReport,
            parentTokenSetId: existing.darkTokenSetId,
            now,
          }),
        }),
        // The replaced pair is soft-deleted, never hard-deleted: CK_TokenSets_contrastGate
        // only requires deletedAt OR contrastValidatedAt, and both are already true here,
        // so this stays a legal row — just no longer live (§7.4's completeness reasoning
        // extended to lineage: a superseded TokenSet is history, not garbage).
        db.tokenSet.updateMany({
          where: { id: { in: [existing.lightTokenSetId, existing.darkTokenSetId] } },
          data: { deletedAt: now },
        }),
        // Unset every OTHER skin's flag BEFORE this one flips to true — same
        // UQ_Skins_tenantDefault ordering requirement buildTokenSetCreateData's
        // sibling comment (the create branch, above) documents; this update
        // branch needs it just as much whenever a tenant switches which skin it
        // is actively editing.
        db.skin.updateMany({
          where: { isTenantDefault: true, id: { not: input.editingSkinId } },
          data: { isTenantDefault: false },
        }),
        db.skin.update({
          where: { id: input.editingSkinId },
          data: {
            name: input.skinName,
            description: input.skinDescription,
            lightTokenSetId: newLightId,
            darkTokenSetId: newDarkId,
            isTenantDefault: true,
            updatedAt: now,
          },
        }),
        db.tenantBranding.upsert(
          tenantBrandingUpsertArgs(
            input.editingSkinId,
            input.branding,
            input.updatedByStaffUserId,
            now,
            true,
          ),
        ),
      ]);
    } catch (error) {
      // A rename (this branch changes `name` too, not only colours) can collide with
      // `UQ_Skins_name` exactly like the create branch above — same handling.
      if (isUniqueConstraintViolation(error)) return { ok: false, reason: "nameTaken" };
      throw error;
    }

    return { ok: true, skinId: input.editingSkinId };
  }

  async applyExistingTenantSkin(
    skinId: string,
    baseline: TenantBrandingScalars,
    updatedByStaffUserId: string,
  ): Promise<{ skinId: string }> {
    const db = getTenantDb(SKIN_OPERATION);
    const now = new Date();

    await db.$transaction([
      // Unset every OTHER skin's flag BEFORE this one flips to true — the same
      // UQ_Skins_tenantDefault ordering the create/update branches of
      // saveTenantAppearance document; the Skin Manager's "Apply" action needs
      // it exactly as much as a full colour save does.
      db.skin.updateMany({
        where: { isTenantDefault: true, id: { not: skinId } },
        data: { isTenantDefault: false },
      }),
      db.skin.update({ where: { id: skinId }, data: { isTenantDefault: true, updatedAt: now } }),
      // updateScalarsToo=false: this action changes ONLY which skin is active. A
      // TenantBranding row that already exists keeps every scalar the last full save
      // gave it; only a brand-new row (no prior save at all) takes `baseline`'s values,
      // via the upsert's `create` branch.
      db.tenantBranding.upsert(
        tenantBrandingUpsertArgs(skinId, baseline, updatedByStaffUserId, now, false),
      ),
    ]);

    return { skinId };
  }

  async createTenantSkin(input: CreateTenantSkinInput): Promise<{ skinId: string }> {
    const db = getTenantDb(SKIN_OPERATION);
    const now = new Date();
    const lightId = newUlid(now);
    const darkId = newUlid(new Date(now.getTime() + 1));
    const skinId = newUlid(new Date(now.getTime() + 2));

    try {
      await db.$transaction([
        db.tokenSet.create({
          data: buildTokenSetCreateData({
            id: lightId,
            namePrefix: input.name,
            mode: "Light",
            tokens: input.light,
            contrastReport: input.lightContrastReport,
            now,
          }),
        }),
        db.tokenSet.create({
          data: buildTokenSetCreateData({
            id: darkId,
            namePrefix: input.name,
            mode: "Dark",
            tokens: input.dark,
            contrastReport: input.darkContrastReport,
            now,
          }),
        }),
        db.skin.create({
          data: {
            id: skinId,
            name: input.name,
            description: input.description,
            lightTokenSetId: lightId,
            darkTokenSetId: darkId,
            isSystem: false,
            // Never active on creation — "Duplicate" and "Import" both land as saved,
            // unapplied skins (§7.4: "An imported skin is never auto-applied").
            isTenantDefault: false,
            status: "Published",
            // Conditional spread for the same exactOptionalPropertyTypes reason
            // buildTokenSetCreateData's own comment documents.
            ...(input.duplicatedFromSkinId !== undefined
              ? { duplicatedFromSkinId: input.duplicatedFromSkinId }
              : {}),
            exportSchemaVersion: SKIN_SCHEMA_VERSION,
            createdByStaffUserId: input.createdByStaffUserId,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ]);
    } catch (error) {
      // Turns a raw `UQ_Skins_name` violation into a message a caller can actually show
      // (Duplicate/Import both funnel through this method — see this method's own doc
      // comment in the port) — matching `saveTenantAppearance`'s identical handling,
      // rather than letting Prisma's raw constraint error reach the UI unexplained.
      if (isUniqueConstraintViolation(error)) {
        throw new Error(`A skin named "${input.name}" already exists in this tenant.`);
      }
      throw error;
    }

    return { skinId };
  }

  async renameTenantSkin(skinId: string, name: string, description: string | null): Promise<void> {
    const db = getTenantDb(SKIN_OPERATION);
    try {
      await db.skin.update({
        where: { id: skinId },
        data: { name, description, updatedAt: new Date() },
      });
    } catch (error) {
      if (isUniqueConstraintViolation(error)) {
        throw new Error(`A skin named "${name}" already exists in this tenant.`);
      }
      throw error;
    }
  }

  async deleteTenantSkin(skinId: string): Promise<TenantSkinDeletionResult> {
    const db = getTenantDb(SKIN_OPERATION);
    const now = new Date();
    try {
      // Soft delete — the schema's real "deleted" path throughout this table (§4.16) —
      // which is exactly what TR_Skins_blockActiveDeletion/TR_Skins_blockSystemDelete
      // watch for (both fire on UPDATE ... SET deletedAt, not only on a hard DELETE).
      await db.skin.update({ where: { id: skinId }, data: { deletedAt: now, updatedAt: now } });
      return { blocked: false };
    } catch (error) {
      const reason = blockingTriggerReason(error);
      if (reason) return { blocked: true, reason };
      throw error;
    }
  }

  async applyUserSkin(staffUserId: string, skinId: string | null): Promise<void> {
    const db = getTenantDb(OPERATION);
    const now = new Date();
    await db.userThemePreference.upsert({
      where: { staffUserId },
      create: {
        id: newUlid(now),
        staffUserId,
        skinId,
        mode: null,
        density: null,
        direction: null,
        fontSize: null,
        reducedMotion: null,
        createdAt: now,
        updatedAt: now,
      },
      update: { skinId, updatedAt: now },
    });
  }

  async saveUserPreferenceScalars(
    staffUserId: string,
    input: UserPreferenceScalarsInput,
  ): Promise<void> {
    const db = getTenantDb(OPERATION);
    const now = new Date();
    await db.userThemePreference.upsert({
      where: { staffUserId },
      create: {
        id: newUlid(now),
        staffUserId,
        skinId: null,
        mode: input.mode,
        density: input.density,
        direction: input.direction,
        fontSize: input.fontSize,
        reducedMotion: input.reducedMotion,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        mode: input.mode,
        density: input.density,
        direction: input.direction,
        fontSize: input.fontSize,
        reducedMotion: input.reducedMotion,
        updatedAt: now,
      },
    });
  }

  async resetTenantBrandingToSystemDefault(): Promise<void> {
    const db = getTenantDb(OPERATION);
    // deleteMany rather than delete-by-id: a genuine no-op (0 rows affected) when the
    // singleton does not exist, matching the port's documented "no-op if absent"
    // contract without a separate existence check racing the delete itself.
    await db.tenantBranding.deleteMany({});
  }

  async resetUserPreferenceToDefault(staffUserId: string): Promise<void> {
    const db = getTenantDb(OPERATION);
    const now = new Date();
    // upsert: a user resetting a preference they never explicitly set (no row yet) is
    // already at every default — creating the all-NULL row makes that state durable
    // and explicit rather than silently doing nothing.
    await db.userThemePreference.upsert({
      where: { staffUserId },
      create: {
        id: newUlid(now),
        staffUserId,
        skinId: null,
        mode: null,
        density: null,
        direction: null,
        fontSize: null,
        reducedMotion: null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        skinId: null,
        mode: null,
        density: null,
        direction: null,
        fontSize: null,
        reducedMotion: null,
        updatedAt: now,
      },
    });
  }

  /**
   * The one write path this adapter's own theming-backend precedent didn't need
   * until this wave — see `ThemeRepository.saveBrandAsset`'s own doc comment for
   * the full contract. Two real constraints this method exists specifically to
   * respect, neither reachable from `saveTenantAppearance`'s own write shape:
   *
   * 1. `UQ_BrandAssets_checksum_kind` — re-uploading byte-identical content for the
   *    same `kind` must reuse the existing row, never violate the unique index.
   * 2. `TenantBranding.activeSkinId`'s NOT NULL FK — there may be no row to attach
   *    to yet (§4.16, see `SaveBrandAssetResult`'s `noTenantBranding` doc comment),
   *    checked BEFORE any write, so an upload attempted too early never creates a
   *    partial/invalid `TenantBranding` row.
   */
  async saveBrandAsset(input: SaveBrandAssetInput): Promise<SaveBrandAssetResult> {
    const db = getTenantDb(SKIN_OPERATION);
    const now = new Date();

    const existingBranding = await db.tenantBranding.findFirst({
      select: {
        logoLightAsset: { select: { storageRef: true } },
        logoDarkAsset: { select: { storageRef: true } },
        faviconAsset: { select: { storageRef: true } },
      },
    });
    if (!existingBranding) {
      return { ok: false, reason: "noTenantBranding" };
    }
    const previousUrl = previousUrlForKind(input.kind, existingBranding);

    // Dedup on (checksum, kind) — see this method's own doc comment, point 1.
    const existingAsset = await db.brandAsset.findFirst({
      where: { checksum: input.checksum, kind: input.kind },
      select: { id: true, storageRef: true },
    });

    const assetId = existingAsset?.id ?? newUlid(now);
    if (!existingAsset) {
      await db.brandAsset.create({
        data: {
          id: assetId,
          kind: input.kind,
          fileName: input.fileName,
          mimeType: input.mimeType,
          byteSize: input.byteSize,
          width: input.width,
          height: input.height,
          checksum: input.checksum,
          storageRef: input.url,
          uploadedByStaffUserId: input.uploadedByStaffUserId,
          createdAt: now,
          updatedAt: now,
        },
      });
    }

    await db.tenantBranding.update({
      where: { singletonKey: 1 },
      data: {
        ...brandAssetColumnPatch(input.kind, assetId),
        updatedByStaffUserId: input.uploadedByStaffUserId,
        updatedAt: now,
      },
    });

    return { ok: true, assetId, url: existingAsset?.storageRef ?? input.url, previousUrl };
  }
}

/** The one `TenantBranding` foreign-key column `input.kind` writes — never the
 *  other two, matching `SaveBrandAssetInput`'s own "one write per upload"
 *  contract. */
function brandAssetColumnPatch(
  kind: BrandAssetKind,
  assetId: string,
): { logoLightAssetId: string } | { logoDarkAssetId: string } | { faviconAssetId: string } {
  if (kind === "LogoLight") return { logoLightAssetId: assetId };
  if (kind === "LogoDark") return { logoDarkAssetId: assetId };
  return { faviconAssetId: assetId };
}

function previousUrlForKind(
  kind: BrandAssetKind,
  branding: {
    logoLightAsset: { storageRef: string } | null;
    logoDarkAsset: { storageRef: string } | null;
    faviconAsset: { storageRef: string } | null;
  },
): string | null {
  if (kind === "LogoLight") return branding.logoLightAsset?.storageRef ?? null;
  if (kind === "LogoDark") return branding.logoDarkAsset?.storageRef ?? null;
  return branding.faviconAsset?.storageRef ?? null;
}
