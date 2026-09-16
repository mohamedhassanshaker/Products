/**
 * A `ThemeRepository` for a request with no bound `TenantContext` at all.
 *
 * Not a test double — a real, production null-object adapter for a real, current gap:
 * nothing in this codebase yet binds a `TenantContext` for an ordinary page request
 * (`middleware.ts` only negotiates the locale; tenant resolution from a channel
 * registry is B-6, and staff session resolution wired into the App Router is B-2 —
 * neither exists yet). `getTenantDb()` throws `MissingTenantContextError` by design
 * when no context is bound ("a missing context is a programming error" — its own doc
 * comment), which is correct for feature code, but the root layout must render
 * *something* for every request regardless, including today's, which has none.
 *
 * Returning `null`/no-ops from every method makes `resolveTheme()` fall through the
 * exact same, already-tested "no tenant branding, no user preference" path a bound-
 * but-unbranded tenant already uses — one fallback behaviour, not a special case —
 * so the day a real `TenantContext` starts getting bound here, swapping this adapter
 * for `PrismaThemeRepository` is the only change needed.
 *
 * ## The SkinEditor extension (2026-09-09)
 *
 * The new write methods below all throw rather than silently no-op. `resetAppearance`
 * and `resolveTheme` above are read-heavy paths a fully anonymous page render must
 * survive, so their no-op contract stands. Every SkinEditor write, by contrast, is
 * only ever reachable from a Server Action that already required a bound
 * `TenantContext` and a real principal (`appearance:manage` or an authenticated
 * session — see `settings/appearance/actions.ts`) before it could call this far, so a
 * write landing here anyway is a programming error the same way a missing tenant
 * context is one everywhere else in this codebase — a silent no-op would misreport a
 * save as having succeeded when nothing was persisted, which is a worse failure mode
 * than a loud 500. The read methods stay `null`/`[]` so the Settings -> Appearance
 * PAGE can still render its own honest "no tenant context" empty state instead of
 * crashing (see that route's own doc comment).
 */

import type {
  SaveBrandAssetResult,
  TenantBrandingSnapshot,
  TenantSkinDeletionResult,
  TenantSkinDetail,
  TenantSkinSummary,
  ThemeRepository,
  UserPreferenceSnapshot,
} from "../../ports/theme-repository.js";

function unreachableWrite(operation: string): never {
  throw new Error(
    `${operation} was called with no bound tenant context. This is reachable only from a ` +
      "Server Action that already required an authenticated principal — a write reaching " +
      "NullThemeRepository anyway is a programming error, not a state to persist through.",
  );
}

export class NullThemeRepository implements ThemeRepository {
  async readTenantBranding(): Promise<TenantBrandingSnapshot | null> {
    return null;
  }

  async readUserPreference(): Promise<UserPreferenceSnapshot | null> {
    return null;
  }

  async listTenantSkins(): Promise<readonly TenantSkinSummary[]> {
    return [];
  }

  async readTenantSkinDetail(): Promise<TenantSkinDetail | null> {
    return null;
  }

  async saveTenantAppearance(): Promise<
    { ok: true; skinId: string } | { ok: false; reason: "nameTaken" }
  > {
    unreachableWrite("saveTenantAppearance");
  }

  async applyExistingTenantSkin(): Promise<{ skinId: string }> {
    unreachableWrite("applyExistingTenantSkin");
  }

  async createTenantSkin(): Promise<{ skinId: string }> {
    unreachableWrite("createTenantSkin");
  }

  async renameTenantSkin(): Promise<void> {
    unreachableWrite("renameTenantSkin");
  }

  async deleteTenantSkin(): Promise<TenantSkinDeletionResult> {
    unreachableWrite("deleteTenantSkin");
  }

  async applyUserSkin(): Promise<void> {
    unreachableWrite("applyUserSkin");
  }

  async saveUserPreferenceScalars(): Promise<void> {
    unreachableWrite("saveUserPreferenceScalars");
  }

  async resetTenantBrandingToSystemDefault(): Promise<void> {
    // Nothing bound, nothing to reset. Not expected to be reachable in practice —
    // the reset route requires an authenticated principal, which requires a bound
    // context — but a safe no-op rather than a throw is the correct contract here.
  }

  async resetUserPreferenceToDefault(): Promise<void> {
    // See resetTenantBrandingToSystemDefault above.
  }

  async saveBrandAsset(): Promise<SaveBrandAssetResult> {
    unreachableWrite("saveBrandAsset");
  }
}
