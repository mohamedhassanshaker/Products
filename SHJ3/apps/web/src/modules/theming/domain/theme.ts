/**
 * Theme resolution — the pure merge logic behind `resolveTheme()` (design-system.md
 * §9.4, `FR-THEME-13/14/15`, ADR-0007).
 *
 * This module holds no vendor imports (architecture.md §4): every function here is a
 * pure transform over already-fetched data, which is what makes the single most
 * important behavioural guarantee in the whole theming module — a per-TOKEN merge,
 * never a whole-object pick — testable without a database and without Next.js.
 *
 * ## Why colours and scalar settings are merged differently
 *
 * §9.3's control matrix splits what a user may override (mode, density, base font
 * size, direction, reduced motion — legibility and comfort) from what only tenant
 * branding controls (brand/semantic colours, logos, typography family, geometry —
 * identity). The schema mirrors that split exactly: `UserThemePreference` has no
 * colour columns at all, only named scalar fields, so "per-token merge" for those is
 * already true by construction — each is resolved independently with a `??` chain.
 * Colours are the one place a real object-level merge is needed, because a tenant's
 * *complete* active-skin token set is overlaid on the system default's, key by key —
 * `{...system, ...tenant}` — so a system token the tenant skin never customised still
 * comes through, and a schema evolution that adds a 67th token to the system default
 * is not silently missing from a tenant skin saved before that token existed.
 *
 * A third tier exists for colour only: §9.3 also allows "Import / export skins:
 * Personal skins only", so a user may select their own personal skin, whose colours —
 * if present — win over the tenant's, per token, exactly the same way.
 */

import type { ColorMode, SemanticColorTokens, Skin } from "@shj3/tokens";

export type DbMode = "Light" | "Dark" | "System";
export type DbDensity = "Compact" | "Comfortable";
export type DbDirection = "LTR" | "RTL";

/** One of `SkinTypography.baseSize`'s four literal rem values (`@shj3/tokens` `skin.ts`). */
export const FONT_SIZE_VALUES = ["0.8125rem", "0.875rem", "0.9375rem", "1rem"] as const;
export type FontSizeValue = (typeof FONT_SIZE_VALUES)[number];

/** The resolved, request-scoped theme — everything the root layout needs to render. */
export interface ResolvedTheme {
  readonly mode: ColorMode;
  readonly density: DbDensity;
  readonly direction: DbDirection;
  readonly fontSize: FontSizeValue;
  readonly reducedMotion: boolean;
  readonly shadowDepth: string;
  readonly sidebarStyle: string;
  readonly appTitle: string;
  /** The merged, complete 66-role colour set for `mode`. */
  readonly colorTokens: SemanticColorTokens;
  /** §9.1's Brand section: logo (light/dark variants) + favicon — tenant-level
   *  only (§9.3's control matrix has no user-tier row for any of the three), so
   *  each is a direct read of the tenant's own upload, never a merge across
   *  tiers the way `colorTokens` is. `null` when the tenant has not uploaded
   *  that asset (or has no `TenantBranding` row at all yet). */
  readonly logoLightUrl: string | null;
  readonly logoDarkUrl: string | null;
  readonly faviconUrl: string | null;
}

/**
 * Per-token colour merge: system default, then the tenant's active skin, then the
 * user's personal skin (if any) — last wins, per key, never a whole-object pick.
 *
 * `tenantColors`/`personalColors` are each expected to already be a *complete* colour
 * set when present (§7.4 stage 4 fills gaps at save time), so in the common case this
 * spread is equivalent to just using the innermost complete set — the guarantee this
 * function actually buys is for the less common case: a tenant skin saved before a new
 * system token existed, which still resolves to something rather than `undefined`.
 */
export function mergeColorTokens(
  systemColors: SemanticColorTokens,
  tenantColors: SemanticColorTokens | undefined,
  personalColors: SemanticColorTokens | undefined,
): SemanticColorTokens {
  return {
    ...systemColors,
    ...(tenantColors ?? {}),
    ...(personalColors ?? {}),
  };
}

function dbModeToColorMode(mode: DbMode, prefersDark: boolean): ColorMode {
  if (mode === "System") return prefersDark ? "dark" : "light";
  return mode === "Dark" ? "dark" : "light";
}

/**
 * Resolve the effective light/dark mode. User's choice wins over the tenant's default;
 * "System" at whichever tier wins resolves against `prefersDark` (§9.4) rather than
 * falling through to the next tier — a user who explicitly chose "follow system" gets
 * the system's answer, not the tenant's mode.
 */
export function resolveMode(
  userMode: DbMode | null | undefined,
  tenantMode: DbMode | undefined,
  prefersDark: boolean,
): ColorMode {
  const chosen = userMode ?? tenantMode ?? "System";
  return dbModeToColorMode(chosen, prefersDark);
}

export function resolveDensity(
  userDensity: DbDensity | null | undefined,
  tenantDensity: DbDensity | undefined,
): DbDensity {
  return userDensity ?? tenantDensity ?? "Comfortable";
}

export function resolveDirection(
  userDirection: DbDirection | null | undefined,
  tenantDirection: DbDirection | undefined,
  localeDirection: DbDirection,
): DbDirection {
  // A direction override, at either tier, wins over the locale's own direction — that
  // is the entire point of "direction override" as a control (§9.1). With neither set,
  // direction follows the locale, matching a skin's own `direction: "locale"` default.
  return userDirection ?? tenantDirection ?? localeDirection;
}

export function resolveFontSize(
  userFontSize: string | null | undefined,
  tenantFontSize: string | undefined,
): FontSizeValue {
  const chosen = userFontSize ?? tenantFontSize ?? "0.875rem";
  return isFontSizeValue(chosen) ? chosen : "0.875rem";
}

function isFontSizeValue(value: string): value is FontSizeValue {
  return (FONT_SIZE_VALUES as readonly string[]).includes(value);
}

/**
 * Reduced motion has no tenant-branding counterpart at all (§9.3's table: a tenant
 * admin cannot force a user into motion that hurts them) — `false` with nothing set,
 * never inherited from anywhere but the user's own row.
 */
export function resolveReducedMotion(userReducedMotion: boolean | null | undefined): boolean {
  return userReducedMotion ?? false;
}

/** The three `TenantBranding` scalar columns with no user-tier counterpart at all
 *  (§9.3's table has no row for shadow depth, sidebar style or app title beneath a
 *  tenant's own choice), so "what does a brand-new, never-branded tenant look like"
 *  has exactly one honest answer: the shipped skin's own published defaults.
 *
 *  One function, used by BOTH `resolve-theme.ts` (reading an ABSENT `TenantBranding`
 *  row) and `manage-appearance.ts` (the baseline for CREATING one for the first
 *  time) — extracted specifically so those two call sites cannot quietly disagree on
 *  what "no tenant branding yet" resolves to; before this existed, the same three
 *  `??` fallback expressions were duplicated by hand at both sites. */
export function systemFallbackAppearance(system: Skin): {
  readonly appTitle: string;
  readonly shadowDepth: string;
  readonly sidebarStyle: string;
} {
  return {
    appTitle: system.assets?.appTitle ?? "SHJ3 Assistant",
    shadowDepth: String(system.geometry?.shadowDepth ?? 1),
    sidebarStyle: system.geometry?.sidebarStyle ?? "neutral",
  };
}
