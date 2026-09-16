/**
 * The `SkinEditor` organism's OWN vocabulary.
 *
 * Deliberately NOT imported from `modules/theming` — `eslint.config.mjs`'s
 * component-library boundary (`boundaries/element-types`) restricts the
 * `components` element to depending on `components`/`shared` only, never a
 * `feature` module: "a component that reaches into backend code stops being
 * swappable independently of the app that consumes it" (design-system.md §5.1,
 * `tasks/todo.md`'s B-1 infra-scaffolding entry). `PermissionMatrix`'s own
 * `confirmChange` seam already established the pattern this file follows: a
 * generic type vocabulary with no feature-specific names baked in.
 *
 * These types deliberately MIRROR `modules/theming/domain/theme.ts`'s
 * `DbMode`/`DbDensity`/`DbDirection` and `ports/theme-repository.ts`'s
 * `TenantBrandingScalars`/`TenantSkinSummary`/`TenantSkinDeletionResult` — the
 * Settings -> Appearance route (an `app`-type file, which the same boundary rule
 * allows to depend on both `feature` and `components`) is what maps between the
 * two; see `app/[locale]/settings/appearance/page.tsx`. Duplicating a handful of
 * small literal-union types is the price of the swap test actually holding for
 * this organism.
 */

export type SkinEditorMode = "Light" | "Dark" | "System";
export type SkinEditorDirection = "LTR" | "RTL";
export type SkinEditorDensity = "Compact" | "Comfortable";

/** Mirrors `FONT_SIZE_VALUES` (`modules/theming/domain/theme.ts`), itself derived
 *  from `SkinTypography.baseSize`'s four literal stops in `@shj3/tokens`' `skin.ts`
 *  (§7.2). Importing a type or constant straight from `@shj3/tokens` is fine here —
 *  that package is outside `apps/web/src/**` entirely, so the boundary rule above
 *  does not cover it at all — but `FONT_SIZE_VALUES` the *tuple* is re-exported from
 *  the feature module, not the package itself, so its four literal stops are
 *  restated here rather than imported across the boundary. */
export const SKIN_EDITOR_FONT_SIZES = ["0.8125rem", "0.875rem", "0.9375rem", "1rem"] as const;
export type SkinEditorFontSize = (typeof SKIN_EDITOR_FONT_SIZES)[number];

export interface SkinEditorBrandingScalars {
  readonly appTitle: string;
  readonly defaultMode: SkinEditorMode;
  readonly defaultDirection: SkinEditorDirection;
  readonly density: SkinEditorDensity;
  readonly fontSize: string;
  readonly shadowDepth: string;
  readonly sidebarStyle: string;
}

export interface SkinEditorPersonalPreference {
  readonly mode: SkinEditorMode | null;
  readonly density: SkinEditorDensity | null;
  readonly direction: SkinEditorDirection | null;
  readonly fontSize: string | null;
  readonly reducedMotion: boolean | null;
}

export interface SkinEditorSkinEntry {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly isActive: boolean;
  readonly isSystem: boolean;
  readonly updatedAt: string | null;
}

export type SkinEditorDeletionResult =
  { readonly blocked: false } | { readonly blocked: true; readonly reason: string };

/** Mirrors `modules/theming/domain/brand-asset.ts`'s `BrandAssetKind` — the third
 *  member (`Favicon`) is deliberately included even though it has no light/dark
 *  variant, matching the real schema's own `CK_BrandAssets_kind` vocabulary. */
export type SkinEditorBrandAssetKind = "LogoLight" | "LogoDark" | "Favicon";

/** §9.1's Brand section: "Logo light, logo dark, ... favicon (upload -> assetId)"
 *  — the tenant's currently-active uploads, `null` where nothing has been
 *  uploaded yet. Mirrors `TenantBrandingSnapshot`'s own three URL fields. */
export interface SkinEditorBrandAssets {
  readonly logoLightUrl: string | null;
  readonly logoDarkUrl: string | null;
  readonly faviconUrl: string | null;
}

export type SkinEditorUploadBrandAssetResult =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly errorCode: "invalidType" | "tooLarge" | "noTenantBranding" };
