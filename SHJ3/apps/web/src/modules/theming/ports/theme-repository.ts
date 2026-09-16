/**
 * The read (and reset-write) surface `resolveTheme()` and the reset route depend on.
 *
 * One port, no vendor imports (architecture.md §4) — the real implementation is
 * `adapters/outbound/sql/prisma-theme-repository.ts`; tests use
 * `testing/fakes.ts`'s `FakeThemeRepository`.
 *
 * **Deliberately no `readSystemDefaultColors` method here.** The system tier is
 * `@shj3/tokens`' own static `systemSkin(mode)` / `semanticColors[mode]` export, read
 * directly by `resolve-theme.ts` — not a live database read, for a real reason found
 * while designing this adapter, not a shortcut: `getPlatformDb()` is deliberately
 * gated to exactly two AUDITED cross-tenant purposes, tenant provisioning and
 * analytics rollups (ADR-0002 rule 5, `provisioning.ts`'s own doc comment — "anything
 * reading this must write an audit entry"). Reading the tiny, public, read-only
 * system-default colour set on every single request is neither of those, and writing
 * an audit entry on every page load would be absurd. The seeded `platform.Skins` row
 * (`seed-system-skins.ts`) still exists and still serves its own stated purpose — a
 * future admin-facing "list every skin, including the two shipped ones" screen has one
 * consistent source rather than special-casing them — but the hot, per-request colour
 * read does not need it, and using the static export is *more* correct for §9.4's own
 * goal (no flash of default theme), not just cheaper.
 */

import type { ColorMode, ContrastReport, SemanticColorTokens } from "@shj3/tokens";
import type { DbDensity, DbDirection, DbMode } from "../domain/theme.js";
import type { BrandAssetKind } from "../domain/brand-asset.js";

/** The tenant's applied branding — absent entirely for "every tenant with no tenant
 *  branding" (design-system.md §9.3's own resolution-table row, not an edge case). */
export interface TenantBrandingSnapshot {
  readonly appTitle: string;
  readonly defaultMode: DbMode;
  readonly defaultDirection: DbDirection;
  readonly density: DbDensity;
  readonly fontSize: string;
  readonly shadowDepth: string;
  readonly sidebarStyle: string;
  /** The active skin's already-complete colour sets for both modes (§7.4 stage 4). */
  readonly activeSkinColors: Readonly<Record<ColorMode, SemanticColorTokens>>;
  /** §9.1's "Logo light, logo dark, ... favicon" — tenant-level only, per §9.3's
   *  control matrix (branding, never a personal preference), so there is no user-
   *  tier counterpart to merge against the way colours/scalars have (see
   *  `ResolvedTheme`'s own doc comment). `null` when the tenant has never uploaded
   *  that asset — the app falls back to no logo / the shipped default favicon,
   *  never a broken image reference. */
  readonly logoLightUrl: string | null;
  readonly logoDarkUrl: string | null;
  readonly faviconUrl: string | null;
}

/** One staff user's personal preference — absent when they have never visited
 *  Settings -> Appearance. */
export interface UserPreferenceSnapshot {
  readonly mode: DbMode | null;
  readonly density: DbDensity | null;
  readonly direction: DbDirection | null;
  readonly fontSize: string | null;
  readonly reducedMotion: boolean | null;
  /** The user's personally-selected skin's colours (§9.3: "Import/export skins:
   *  Personal skins only"), for both modes — `null` when no personal skin is chosen,
   *  or the chosen one is no longer live (soft-deleted): a dangling reference defers
   *  to the tenant tier rather than erroring (see `UserThemePreference.skinId`'s
   *  doc comment in prisma/tenant/schema.prisma for why no DB trigger prevents this). */
  readonly personalSkinColors: Readonly<Record<ColorMode, SemanticColorTokens>> | null;
}

/** One row in the tenant's own `Skins` table, without its colours — the Skin
 *  Manager's list view (design-system.md §9.1's "Skin manager: list, apply,
 *  duplicate, rename, delete, export, import"). Deliberately excludes `light`/
 *  `dark` tokens: a list of N skins has no use for N pairs of 66-key colour
 *  records, and `readTenantSkinDetail` below is the per-skin fetch for when it
 *  does. */
export interface TenantSkinSummary {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  /** True for the one skin `TenantBranding.activeSkinId` currently names. */
  readonly isActive: boolean;
  readonly updatedAt: string;
}

/** One named tenant skin's full colour pair, for the editor to load into a
 *  candidate (§9.2) or for `serializeSkin`-based export. */
export interface TenantSkinDetail extends TenantSkinSummary {
  readonly light: SemanticColorTokens;
  readonly dark: SemanticColorTokens;
}

/** A contrast-gated colour pair, always accompanied by the report that already
 *  proved it passes (`appearance-gate.ts`'s `assertContrastPasses`) — the
 *  repository persists `contrastReportJson`/`contrastValidatedAt` from a report
 *  it trusts its caller already computed, rather than recomputing (mirrors
 *  `PrismaSystemSkinSeeder`'s established input shape). */
export interface GatedSkinColors {
  readonly light: SemanticColorTokens;
  readonly dark: SemanticColorTokens;
  readonly lightContrastReport: ContrastReport;
  readonly darkContrastReport: ContrastReport;
}

/** Every `TenantBranding` scalar column the SkinEditor's Layout/Brand/Mode
 *  sections write, grouped because §9.2 rule 1 saves them together with the
 *  colours in one transaction — there is no per-control save. Deliberately
 *  excludes `sidebarWidth`/`radiusRoot`/font-family/`scaleRatio`/`baseWeight`/
 *  focus-ring width and offset: no column exists for any of them today (see
 *  this interface's use in `saveTenantAppearance`'s doc comment, and the
 *  `TenantBranding` Prisma model's own comment — "the shipped skins' typography
 *  and geometry are otherwise identical and are served from `@shj3/tokens`'
 *  static exports rather than round-tripped through a row"). Extending the
 *  schema to add them is real, deliberately out-of-scope follow-up work, not an
 *  oversight here — see `tasks/todo.md`'s review entry for this wave.
 *
 *  Direction is deliberately NOT `"locale"`-capable at this tier: the column is
 *  `NOT NULL VarChar(3)` (`"LTR"` | `"RTL"` only), so once ANY `TenantBranding`
 *  row exists it must commit to a concrete direction — there is no persisted
 *  "follow locale" tenant default, unlike the user tier's genuinely-nullable
 *  `direction` column. The SkinEditor's tenant-level direction control offers
 *  only Force LTR / Force RTL for exactly this reason (a real schema
 *  constraint, not an arbitrary UI simplification).
 */
export interface TenantBrandingScalars {
  readonly appTitle: string;
  readonly defaultMode: DbMode;
  readonly defaultDirection: DbDirection;
  readonly density: DbDensity;
  readonly fontSize: string;
  readonly shadowDepth: string;
  readonly sidebarStyle: string;
}

/** The editor's main "Save" — see `saveTenantAppearance`'s own doc comment. */
export interface SaveTenantAppearanceInput extends GatedSkinColors {
  /** The tenant `Skin` currently being edited, or `null` to create a new one —
   *  `null` the first time a tenant customises anything (no tenant skin exists
   *  yet, so there is nothing to update), or whenever the editor is deliberately
   *  "saving as a new skin" rather than overwriting the one it started from. */
  readonly editingSkinId: string | null;
  readonly skinName: string;
  readonly skinDescription: string | null;
  readonly branding: TenantBrandingScalars;
  readonly updatedByStaffUserId: string;
}

/** Creates a brand-new, unapplied tenant `Skin` — the Skin Manager's
 *  "Duplicate" and "Import" actions (§7.4's own rule that an import is never
 *  auto-applied), and also `saveTenantAppearance`'s internal create path when
 *  `editingSkinId` is `null`. */
export interface CreateTenantSkinInput extends GatedSkinColors {
  readonly name: string;
  readonly description: string | null;
  readonly createdByStaffUserId: string;
  /** Set when duplicating an existing TENANT skin (the self-relation FK can
   *  only target another row in this same tenant `Skins` table — never the
   *  platform-schema system skin, which is why "duplicate the system default"
   *  leaves this `undefined` rather than attempting a cross-schema reference;
   *  see `manage-appearance.ts`'s own doc comment). */
  readonly duplicatedFromSkinId?: string;
}

/** The trigger-aware result of a delete attempt — `TR_Skins_blockActiveDeletion`
 *  (and, defensively, `TR_Skins_blockSystemDelete`) can refuse a soft-delete at
 *  the database, and the brief is explicit that the UI must surface that block
 *  legibly rather than let a raw SQL error reach the user. */
export type TenantSkinDeletionResult =
  { readonly blocked: false } | { readonly blocked: true; readonly reason: string };

/** Every column `saveUserPreferenceScalars` writes together — mirrors
 *  `UserPreferenceSnapshot`'s own field set (minus `personalSkinColors`, which
 *  is derived from `applyUserSkin`'s pointer, not a scalar). */
export interface UserPreferenceScalarsInput {
  readonly mode: DbMode | null;
  readonly density: DbDensity | null;
  readonly direction: DbDirection | null;
  readonly fontSize: string | null;
  readonly reducedMotion: boolean | null;
}

/** Every column `saveBrandAsset` needs to write both the `BrandAsset` row and the
 *  matching `TenantBranding.logo*AssetId`/`faviconAssetId` foreign key — the bytes
 *  themselves have already been validated and persisted by `BrandAssetStorage`
 *  (`UploadBrandAsset`'s own orchestration) by the time this is called; this
 *  method only ever writes rows, never bytes. */
export interface SaveBrandAssetInput {
  readonly kind: BrandAssetKind;
  /** The client's original filename, kept as display metadata only — never used to
   *  construct a storage path (see `BrandAssetStorage`'s own doc comment). */
  readonly fileName: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly width: number | null;
  readonly height: number | null;
  readonly checksum: string;
  /** The already-stored asset's public URL (`BrandAssetStorage.store()`'s result) —
   *  persisted verbatim into `BrandAssets.storageRef` (see that adapter's own doc
   *  comment for why this implementation keeps "storage reference" and "public
   *  URL" as the same value, and what a real cloud adapter would need to split). */
  readonly url: string;
  readonly uploadedByStaffUserId: string;
}

export type SaveBrandAssetResult =
  | {
      readonly ok: true;
      readonly assetId: string;
      /** The URL now live on `TenantBranding` for this `kind` — identical to
       *  `SaveBrandAssetInput.url` UNLESS an identical-bytes asset of the same
       *  `kind` already existed (`UQ_BrandAssets_checksum_kind`), in which case
       *  this is that EXISTING asset's URL and the caller must delete the file it
       *  just wrote (see `UploadBrandAsset`'s own doc comment). */
      readonly url: string;
      /** The URL this `kind` pointed at before this write, or `null` if this is
       *  the tenant's first upload of this kind — the caller's cue to best-effort
       *  delete the file the newly-active asset just replaced. */
      readonly previousUrl: string | null;
    }
  | {
      readonly ok: false;
      /** No `TenantBranding` row exists yet for this tenant — `activeSkinId` is a
       *  NOT NULL foreign key into this tenant's own `Skins` table (§4.16), so
       *  there is no row this write could attach to until the tenant has saved an
       *  appearance at least once (the main editor's Save, or the Skin Manager's
       *  Apply). See `brand-section.tsx`'s own gated-upload UI for how this
       *  surfaces as an honest, translated notice rather than a raw error. */
      readonly reason: "noTenantBranding";
    };

export interface ThemeRepository {
  /** The calling tenant's `TenantBranding` singleton, or `null` if none exists yet. */
  readTenantBranding(): Promise<TenantBrandingSnapshot | null>;

  /** One staff user's `UserThemePreference` row in the calling tenant, or `null`. */
  readUserPreference(staffUserId: string): Promise<UserPreferenceSnapshot | null>;

  /** Every non-deleted skin in the tenant's own `Skins` table (§9.1's Skin
   *  Manager). Does **not** include the platform-seeded system default — that
   *  is a synthetic, always-present entry the application layer adds from
   *  `@shj3/tokens`' static export, the same "no `getPlatformDb()` on a
   *  per-request path" reasoning `ThemeRepository`'s own module doc comment
   *  already gives for colour resolution (see `manage-appearance.ts`). */
  listTenantSkins(): Promise<readonly TenantSkinSummary[]>;

  /** One tenant skin's full colour pair, for the editor to load or to export
   *  (`serializeSkin`). `null` if the id does not resolve to a live (non
   *  soft-deleted) skin in this tenant. */
  readTenantSkinDetail(skinId: string): Promise<TenantSkinDetail | null>;

  /**
   * The SkinEditor's main Save (§9.2 rule 1 — atomic, no per-control save).
   *
   * Creates a new tenant `Skin` + `TokenSet` pair (when `editingSkinId` is
   * `null`) or replaces the existing skin's colours with a new `TokenSet` pair
   * via the lineage FK (`TokenSet.parentTokenSetId`), soft-deleting the pair it
   * replaces — never mutates a `TokenSet` row in place, so a skin's colour
   * history stays reconstructable. Either way, every `TenantBranding` scalar
   * column is written and the (new-or-updated) skin becomes
   * `TenantBranding.activeSkinId`, all in the one transaction that makes "never
   * half-applied" true rather than claimed. Creates the `TenantBranding`
   * singleton row if this is the tenant's first-ever appearance save.
   *
   * `{ ok: false, reason: "nameTaken" }` on the create path (`editingSkinId ===
   * null`) whenever `skinName` collides with `UQ_Skins_name` (a filtered unique
   * index, `WHERE deletedAt IS NULL`) — a real, previously-uncaught case: a fixed
   * default name (this screen's own, or the platform-admin cross-tenant screen's)
   * collides with any skin the tenant already has under that exact name,
   * including one left behind by a prior save-then-reset cycle (`ResetAppearance
   * .resetTenantBranding` clears `TenantBranding` but does not touch the `Skin`
   * row it stops pointing at). Surfaced as a structured result instead of the raw
   * Prisma `P2002` error reaching the caller, matching `deleteTenantSkin`'s own
   * established convention for turning a constraint violation into something the
   * UI can render a real message for.
   */
  saveTenantAppearance(
    input: SaveTenantAppearanceInput,
  ): Promise<{ ok: true; skinId: string } | { ok: false; reason: "nameTaken" }>;

  /**
   * The Skin Manager's "Apply" action on an ALREADY-SAVED skin — repoints
   * `TenantBranding.activeSkinId` and nothing else (no colour or scalar
   * change). `baseline` supplies every `TenantBranding` NOT-NULL column for the
   * rare case no `TenantBranding` row exists yet (a tenant that goes straight
   * to the Skin Manager without ever touching the main editor sections) —
   * ignored when a row already exists, where only `activeSkinId` and the audit
   * columns change.
   */
  applyExistingTenantSkin(
    skinId: string,
    baseline: TenantBrandingScalars,
    updatedByStaffUserId: string,
  ): Promise<{ skinId: string }>;

  /** Creates a new, unapplied tenant skin — "Duplicate" (from another tenant
   *  skin) and "Import" (from a validated, untrusted file, §7.4) both funnel
   *  through this one method; the caller decides whether to call
   *  `applyExistingTenantSkin` afterward. Throws a plain, readable `Error`
   *  (never the raw Prisma `P2002`) when `name` collides with `UQ_Skins_name` —
   *  see `saveTenantAppearance`'s own doc comment for the real scenario this
   *  guards against. */
  createTenantSkin(input: CreateTenantSkinInput): Promise<{ skinId: string }>;

  /** Metadata-only — name/description, never colours. Same `UQ_Skins_name`
   *  handling as `createTenantSkin`. */
  renameTenantSkin(skinId: string, name: string, description: string | null): Promise<void>;

  /** Soft-deletes a tenant skin, surfacing `TR_Skins_blockActiveDeletion` (and,
   *  defensively, `TR_Skins_blockSystemDelete`) as a structured result instead
   *  of letting the raw SQL Server error (51021 / 51020) reach the caller. */
  deleteTenantSkin(skinId: string): Promise<TenantSkinDeletionResult>;

  /** Sets or clears (`null`) one staff user's personally-selected skin
   *  (`UserThemePreference.skinId`) — §9.3's "Import/export skins: Personal
   *  skins only" row. Creates the `UserThemePreference` row if the user has
   *  never visited Settings -> Appearance before. */
  applyUserSkin(staffUserId: string, skinId: string | null): Promise<void>;

  /** Every user-overridable scalar together (§9.3's table: mode, density,
   *  direction, font size, reduced motion) — `null` on any field defers that
   *  field to the tenant tier, matching every other column on this table.
   *  Creates the row if this is the user's first visit. */
  saveUserPreferenceScalars(staffUserId: string, input: UserPreferenceScalarsInput): Promise<void>;

  /**
   * Reset the calling tenant back to "no tenant branding" — the tenant-wide half of
   * the `/settings/appearance/reset` escape hatch (§9.2 rule 5).
   *
   * Implemented as deleting the `TenantBranding` singleton row, not as pointing
   * `activeSkinId` at some system-default stand-in: `TenantBranding.activeSkinId`'s
   * foreign key targets this TENANT's own `Skin` table, not `platform.Skins` — a
   * tenant's active skin is always a row in its own schema (ADR-0002's isolation
   * argument again: no cross-schema pointer). Deleting the row instead makes the
   * tenant fall back through the exact same "every tenant with no tenant branding"
   * path (§9.3's own resolution destination) that a brand-new, never-branded tenant
   * already uses — one fallback mechanism, not two. `TenantBranding` has no
   * `deletedAt` column (unlike `Skins`), so this is a real, hard delete of the
   * singleton, not a soft one.
   *
   * A no-op, successfully, if the tenant has no `TenantBranding` row at all: it is
   * already at the system default in every observable sense.
   */
  resetTenantBrandingToSystemDefault(updatedByStaffUserId: string): Promise<void>;

  /**
   * Reset one staff user's `UserThemePreference` to fully defer to the tenant tier
   * (every column `NULL`) — the personal half of the reset route, available to any
   * authenticated user resetting their own preference (§9.3: "the user, for themselves").
   */
  resetUserPreferenceToDefault(staffUserId: string): Promise<void>;

  /**
   * Persists one already-stored brand asset's ROW (`BrandAssets` + the matching
   * `TenantBranding` foreign key) — see `SaveBrandAssetInput`/`Result`'s own doc
   * comments for the dedup (`UQ_BrandAssets_checksum_kind`) and "no TenantBranding
   * yet" cases. Deliberately narrower than `saveTenantAppearance`: this touches
   * only the ONE `logo*AssetId`/`faviconAssetId` column for `input.kind`, never
   * any other `TenantBranding` scalar — an upload must not silently revert an
   * admin's unsaved colour/typography edits sitting in the SkinEditor's candidate.
   */
  saveBrandAsset(input: SaveBrandAssetInput): Promise<SaveBrandAssetResult>;
}
