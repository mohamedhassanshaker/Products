/**
 * The SkinEditor's write-side orchestration (design-system.md §9.1/§9.2, the
 * `SkinEditor` organism's backing use case).
 *
 * Holds no vendor imports (architecture.md §4) beyond `@shj3/tokens`, which this
 * module treats as a shared kernel exactly the way `resolve-theme.ts` already does
 * (that file's own doc comment: the system tier is `@shj3/tokens`' static export,
 * read directly, never `getPlatformDb()` — see below for why that reasoning extends
 * here too). Every method is a thin, testable orchestration over `ThemeRepository`;
 * the interesting DECISIONS below (never the raw persistence) are what this class
 * exists to hold in one reviewable place rather than scattered across Server Actions.
 *
 * ## Why "duplicate the system default" needs no `getPlatformDb()` call
 *
 * The system default skin lives in `platform.Skins`, reachable only through
 * `getPlatformDb()`, which is gated to two audited cross-tenant purposes —
 * provisioning and analytics rollups (ADR-0002 rule 5) — neither of which "an admin
 * duplicates the shipped skin into their own tenant" is. `resolve-theme.ts` solved
 * the identical problem for the READ path by using `@shj3/tokens`' own static
 * `systemSkin(mode)` export instead of a database read; this module does the same for
 * the "read the system default's colours so they can be copied" case, which needs
 * zero I/O either way.
 *
 * ## Why the personal-skin surface is narrower than §9.3's table taken literally
 *
 * §9.3 lists "Import / export skins: Personal skins only" as something a plain user
 * may do. This module supports the read/apply half in full (any authenticated user
 * may point their own `UserThemePreference.skinId` at ANY already-saved skin — system
 * or tenant-authored — via `applyPersonalSkin`), but does not support a plain user
 * AUTHORING a brand-new custom-colour skin of their own: the schema has no
 * "who owns this skin" column (a tenant `Skin` row is shared/visible tenant-wide the
 * moment it exists, regardless of who created it), so there is no clean way to let a
 * non-admin create colour rows without also, structurally, letting them create rows
 * an admin could later apply tenant-wide. Every colour-authoring method below
 * (`saveTenantAppearance`, `duplicateTenantSkin`, `duplicateSystemDefaultSkin`,
 * `renameTenantSkin`, `deleteTenantSkin`) is therefore gated by the caller requiring
 * `appearance:manage` (`settings/appearance/actions.ts`) — a deliberate, narrower
 * scope than §9.3's literal table, flagged here and in `tasks/todo.md`'s review entry
 * rather than silently done.
 */

import { assertContrastPasses, ContrastBlockedError } from "./appearance-gate.js";
import { resolveSkinTokens, SKIN_SCHEMA_VERSION, systemSkin } from "@shj3/tokens";
import type { ContrastReport, SemanticColorTokens, Skin } from "@shj3/tokens";
import { systemFallbackAppearance, type DbDirection } from "../domain/theme.js";
import { ResetAppearance } from "./reset-appearance.js";
import type {
  TenantBrandingScalars,
  TenantSkinDeletionResult,
  TenantSkinSummary,
  ThemeRepository,
  UserPreferenceScalarsInput,
} from "../ports/theme-repository.js";

/** The Skin Manager's synthetic "always present, cannot be deleted" first row — never
 *  a real id in the tenant's own `Skins` table, so `applyTenantSkin`/`duplicateTenantSkin`
 *  branch on it explicitly rather than ever passing it to the repository. */
export const SYSTEM_DEFAULT_SKIN_ID = "system-default" as const;

export interface SkinManagerEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly isSystem: boolean;
  readonly updatedAt: string | null;
}

export type SaveTenantAppearanceResult =
  | { readonly ok: true; readonly skinId: string }
  | {
      readonly ok: false;
      readonly lightReport: ContrastReport | null;
      readonly darkReport: ContrastReport | null;
      /** Set, with both reports `null`, when `skinName` collides with an existing
       *  skin's name (`UQ_Skins_name`) rather than failing the contrast gate — see
       *  `ThemeRepository.saveTenantAppearance`'s own doc comment for the real
       *  scenario this guards against (a fixed default name colliding with a skin
       *  left behind by a prior save-then-reset cycle). */
      readonly nameTaken?: boolean;
    };

export interface SaveTenantAppearanceCommand {
  readonly editingSkinId: string | null;
  readonly skinName: string;
  readonly skinDescription: string | null;
  readonly light: SemanticColorTokens;
  readonly dark: SemanticColorTokens;
  readonly branding: TenantBrandingScalars;
  readonly updatedByStaffUserId: string;
}

export class ManageAppearance {
  constructor(private readonly repo: ThemeRepository) {}

  /** The Skin Manager's full list: the synthetic system-default entry first, then
   *  every real tenant skin. `hasTenantBranding` is `true` iff the caller already
   *  knows a `TenantBranding` row exists (it already read one to build the editor's
   *  initial candidate) — passed in rather than re-read here, since a second read of
   *  the same row in the same request is pure waste. */
  async listSkinsForManager(hasTenantBranding: boolean): Promise<readonly SkinManagerEntry[]> {
    const tenantSkins = await this.repo.listTenantSkins();
    const system = systemSkin("light");
    const systemEntry: SkinManagerEntry = {
      id: SYSTEM_DEFAULT_SKIN_ID,
      name: system.metadata.name,
      description: system.metadata.description ?? null,
      isActive: !hasTenantBranding,
      isSystem: true,
      updatedAt: null,
    };
    return [
      systemEntry,
      ...tenantSkins.map((skin: TenantSkinSummary) => ({ ...skin, isSystem: false })),
    ];
  }

  /**
   * The editor's main Save (§9.2 rule 1: atomic, no per-control save; rule 2: blocked
   * — not warned — on a text-pair contrast failure). Runs the real gate on BOTH modes
   * independently (rule 6 — they are edited and validated independently) before
   * persisting either; a failure in one mode still reports that mode's specific
   * blockers rather than a generic refusal.
   */
  async saveTenantAppearance(
    command: SaveTenantAppearanceCommand,
  ): Promise<SaveTenantAppearanceResult> {
    const lightOutcome = tryAssertContrast(command.light);
    const darkOutcome = tryAssertContrast(command.dark);
    if (!lightOutcome.passed || !darkOutcome.passed) {
      return {
        ok: false,
        lightReport: lightOutcome.passed ? null : lightOutcome.report,
        darkReport: darkOutcome.passed ? null : darkOutcome.report,
      };
    }

    const result = await this.repo.saveTenantAppearance({
      editingSkinId: command.editingSkinId,
      skinName: command.skinName,
      skinDescription: command.skinDescription,
      light: command.light,
      dark: command.dark,
      lightContrastReport: lightOutcome.report,
      darkContrastReport: darkOutcome.report,
      branding: command.branding,
      updatedByStaffUserId: command.updatedByStaffUserId,
    });
    if (!result.ok) {
      return { ok: false, lightReport: null, darkReport: null, nameTaken: true };
    }
    return { ok: true, skinId: result.skinId };
  }

  /**
   * The Skin Manager's "Apply" action. Applying the synthetic system-default entry
   * IS "no tenant branding" (§9.3's own resolution destination) — routed through the
   * real `ResetAppearance.resetTenantBranding`, which already runs the identical
   * colours through the identical gate, rather than inventing a second "apply"
   * meaning for the one entry that has no row in this tenant's own `Skins` table to
   * repoint `activeSkinId` at.
   */
  async applyTenantSkin(
    skinId: string,
    updatedByStaffUserId: string,
    localeDirection: DbDirection,
  ): Promise<{ skinId: string }> {
    if (skinId === SYSTEM_DEFAULT_SKIN_ID) {
      await new ResetAppearance(this.repo).resetTenantBranding("light", updatedByStaffUserId);
      return { skinId: SYSTEM_DEFAULT_SKIN_ID };
    }
    const baseline = buildTenantBrandingBaseline(localeDirection);
    return this.repo.applyExistingTenantSkin(skinId, baseline, updatedByStaffUserId);
  }

  /** Duplicates an existing TENANT skin under a new name — unapplied, matching §7.4's
   *  "an imported skin is never auto-applied" reasoning extended to Duplicate. */
  async duplicateTenantSkin(
    sourceSkinId: string,
    newName: string,
    createdByStaffUserId: string,
  ): Promise<{ skinId: string }> {
    const source = await this.repo.readTenantSkinDetail(sourceSkinId);
    if (!source) {
      throw new Error(`Cannot duplicate: tenant skin "${sourceSkinId}" no longer exists.`);
    }
    // Recomputed, never copied from a stored report: a duplicate is a NEW, independent
    // row, and this gate must independently clear it rather than trusting the source
    // row's own historical report.
    const lightReport = assertContrastPasses(source.light);
    const darkReport = assertContrastPasses(source.dark);
    return this.repo.createTenantSkin({
      name: newName,
      description: source.description,
      light: source.light,
      dark: source.dark,
      lightContrastReport: lightReport,
      darkContrastReport: darkReport,
      createdByStaffUserId,
      duplicatedFromSkinId: sourceSkinId,
    });
  }

  /** Duplicates the SYSTEM default (the synthetic manager entry) into a real tenant
   *  skin — see the module doc comment for why this needs no `getPlatformDb()` call,
   *  and why `duplicatedFromSkinId` is deliberately omitted (the self-relation FK can
   *  only target another row in this tenant's own `Skins` table). */
  async duplicateSystemDefaultSkin(
    newName: string,
    createdByStaffUserId: string,
  ): Promise<{ skinId: string }> {
    const light = resolveSkinTokens(systemSkin("light"), "light");
    const dark = resolveSkinTokens(systemSkin("dark"), "dark");
    const lightReport = assertContrastPasses(light);
    const darkReport = assertContrastPasses(dark);
    return this.repo.createTenantSkin({
      name: newName,
      description: null,
      light,
      dark,
      lightContrastReport: lightReport,
      darkContrastReport: darkReport,
      createdByStaffUserId,
    });
  }

  async renameTenantSkin(skinId: string, name: string, description: string | null): Promise<void> {
    await this.repo.renameTenantSkin(skinId, name, description);
  }

  /** Surfaces `TR_Skins_blockActiveDeletion`'s block as a structured result — see
   *  `PrismaThemeRepository.deleteTenantSkin`'s own doc comment for how the raw SQL
   *  error is turned into this shape. Never reachable for `SYSTEM_DEFAULT_SKIN_ID`:
   *  the Skin Manager UI does not offer a delete action on the synthetic entry at
   *  all (there is no row to delete), so this method only ever receives a real id. */
  async deleteTenantSkin(skinId: string): Promise<TenantSkinDeletionResult> {
    return this.repo.deleteTenantSkin(skinId);
  }

  /** Any authenticated user pointing THEIR OWN preference at an already-saved skin
   *  (system or tenant) — `null` clears back to the tenant tier. Resolves the id
   *  first (rather than letting a dangling id reach the repository's FK) so a stale
   *  id produces a clean, catchable error instead of a raw constraint violation. */
  async applyPersonalSkin(staffUserId: string, skinId: string | null): Promise<void> {
    if (skinId !== null && skinId !== SYSTEM_DEFAULT_SKIN_ID) {
      const detail = await this.repo.readTenantSkinDetail(skinId);
      if (!detail) {
        throw new Error(`Cannot apply: tenant skin "${skinId}" no longer exists.`);
      }
    }
    // "Apply the system default to me personally" and "clear my personal skin" are
    // the same operation (both defer colour resolution back to the tenant tier) —
    // resolveTheme()'s merge already treats a null personalSkinColors this way, so
    // there is nothing SYSTEM_DEFAULT_SKIN_ID needs beyond being mapped to null here.
    const resolvedSkinId = skinId === SYSTEM_DEFAULT_SKIN_ID ? null : skinId;
    await this.repo.applyUserSkin(staffUserId, resolvedSkinId);
  }

  async savePersonalPreferenceScalars(
    staffUserId: string,
    input: UserPreferenceScalarsInput,
  ): Promise<void> {
    await this.repo.saveUserPreferenceScalars(staffUserId, input);
  }

  /**
   * The Skin Manager's "Export" action — a real, importable `@shj3/tokens` `Skin`
   * JSON document for ONE mode (never a combined light+dark wrapper format
   * `validateSkin` would not recognise; see `skin-manager.tsx`'s own doc comment).
   * Returns the serialised TEXT, not a browser download: a Server Action has no DOM
   * access, so triggering the actual file save is the client's job
   * (`skin-editor.tsx`'s `handleExportSkin`).
   */
  async buildSkinExportDocument(skinId: string, mode: "light" | "dark"): Promise<string> {
    let tokens: SemanticColorTokens;
    let name: string;

    if (skinId === SYSTEM_DEFAULT_SKIN_ID) {
      tokens = resolveSkinTokens(systemSkin(mode), mode);
      name = systemSkin(mode).metadata.name;
    } else {
      const detail = await this.repo.readTenantSkinDetail(skinId);
      if (!detail) throw new Error(`Cannot export: tenant skin "${skinId}" no longer exists.`);
      tokens = mode === "light" ? detail.light : detail.dark;
      name = detail.name;
    }

    const document: Skin = {
      schemaVersion: SKIN_SCHEMA_VERSION,
      metadata: { name, createdAt: new Date().toISOString() },
      mode,
      direction: "locale",
      tokens,
    };
    return JSON.stringify(document, null, 2);
  }
}

/** `assertContrastPasses` throws; this module needs the report on BOTH the pass and
 *  the fail path (a passing report is not needed by any caller today, but returning
 *  it uniformly keeps this helper honest about what the gate actually computed rather
 *  than reconstructing a partial result on the success path). */
function tryAssertContrast(
  tokens: SemanticColorTokens,
): { passed: true; report: ContrastReport } | { passed: false; report: ContrastReport } {
  try {
    const report = assertContrastPasses(tokens);
    return { passed: true, report };
  } catch (error) {
    if (error instanceof ContrastBlockedError) {
      return { passed: false, report: error.report };
    }
    throw error;
  }
}

/** The baseline every NOT-NULL `TenantBranding` column needs the first time a tenant
 *  ever gets a row — used only by `applyTenantSkin`, whose Skin-Manager "Apply" action
 *  can legitimately be the very first appearance action a tenant ever takes (an admin
 *  who goes straight to the manager without touching the main editor sections). */
function buildTenantBrandingBaseline(localeDirection: DbDirection): TenantBrandingScalars {
  const system = systemSkin("light");
  const fallback = systemFallbackAppearance(system);
  return {
    appTitle: fallback.appTitle,
    defaultMode: "System",
    defaultDirection: localeDirection,
    density: "Comfortable",
    fontSize: "0.875rem",
    shadowDepth: fallback.shadowDepth,
    sidebarStyle: fallback.sidebarStyle,
  };
}
