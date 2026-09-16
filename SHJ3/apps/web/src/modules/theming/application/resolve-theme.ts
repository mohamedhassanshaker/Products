/**
 * `resolveTheme()` (design-system.md §9.4) — the use case the root layout calls, on the
 * server, before any markup is streamed.
 *
 * Orchestrates the port and the pure domain resolvers; holds no vendor imports itself
 * (architecture.md §4) — the real Prisma-backed lookups live in
 * `adapters/outbound/sql/prisma-theme-repository.ts`.
 */

import { resolveSkinTokens, systemSkin } from "@shj3/tokens";
import { resolvePrefersDark, type PrefersDarkSignal } from "../domain/prefers-dark.js";
import {
  mergeColorTokens,
  resolveDensity,
  resolveDirection,
  resolveFontSize,
  resolveMode,
  resolveReducedMotion,
  systemFallbackAppearance,
  type DbDirection,
  type ResolvedTheme,
} from "../domain/theme.js";
import type { ThemeRepository } from "../ports/theme-repository.js";

export interface ResolveThemeInput {
  /** `null` for an unauthenticated/no-session request — the citizen-facing assistant
   *  surface has no staff `Principal` (api.md §3.5) and therefore no personal
   *  preference row to read; resolution then runs system default -> tenant only. */
  readonly staffUserId: string | null;
  /** The locale's own direction (design-system.md §11.2) — the base a direction
   *  override, at either tier, wins over. */
  readonly localeDirection: DbDirection;
  readonly prefersDarkSignal: PrefersDarkSignal;
}

export class ResolveTheme {
  constructor(private readonly repo: ThemeRepository) {}

  async execute(input: ResolveThemeInput): Promise<ResolvedTheme> {
    const prefersDark = resolvePrefersDark(input.prefersDarkSignal);

    // Tenant branding and the user's own preference are independent reads; the user
    // read is skipped outright for an anonymous request rather than querying with a
    // null id, which would either be a type error or a query for nothing.
    const [tenantBranding, userPreference] = await Promise.all([
      this.repo.readTenantBranding(),
      input.staffUserId ? this.repo.readUserPreference(input.staffUserId) : null,
    ]);

    const mode = resolveMode(userPreference?.mode, tenantBranding?.defaultMode, prefersDark);
    const density = resolveDensity(userPreference?.density, tenantBranding?.density);
    const direction = resolveDirection(
      userPreference?.direction,
      tenantBranding?.defaultDirection,
      input.localeDirection,
    );
    const fontSize = resolveFontSize(userPreference?.fontSize, tenantBranding?.fontSize);
    const reducedMotion = resolveReducedMotion(userPreference?.reducedMotion);

    // The system tier: @shj3/tokens' own static export, not a database read — see
    // ThemeRepository's doc comment for why (getPlatformDb()'s audited-access gate
    // does not fit a read that happens on every single request).
    const system = systemSkin(mode);
    // resolveSkinTokens, not system.tokens directly: a Skin's own .tokens is typed
    // as the narrower SkinTokens (only the 8 required roles are non-optional,
    // correct for the partial-on-import case §7.4 describes), while the merge below
    // needs a genuinely complete SemanticColorTokens.
    const systemColors = resolveSkinTokens(system, mode);
    const tenantColors = tenantBranding?.activeSkinColors[mode];
    const personalColors = userPreference?.personalSkinColors?.[mode];
    const colorTokens = mergeColorTokens(systemColors, tenantColors, personalColors);
    // Neither shadowDepth/sidebarStyle/appTitle has a user tier (§9.3's table has no
    // row for any of them). A missing TenantBranding falls back to the shipped skin's
    // own published defaults — one shared function (domain/theme.ts) rather than a
    // second, hand-typed copy of "1"/"neutral", since manage-appearance.ts needs the
    // identical fallback when CREATING a TenantBranding row for the first time.
    const fallback = systemFallbackAppearance(system);

    return {
      mode,
      density,
      direction,
      fontSize,
      reducedMotion,
      shadowDepth: tenantBranding?.shadowDepth ?? fallback.shadowDepth,
      sidebarStyle: tenantBranding?.sidebarStyle ?? fallback.sidebarStyle,
      appTitle: tenantBranding?.appTitle ?? fallback.appTitle,
      colorTokens,
      logoLightUrl: tenantBranding?.logoLightUrl ?? null,
      logoDarkUrl: tenantBranding?.logoDarkUrl ?? null,
      faviconUrl: tenantBranding?.faviconUrl ?? null,
    };
  }
}
