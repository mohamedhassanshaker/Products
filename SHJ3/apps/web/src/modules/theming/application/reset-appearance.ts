/**
 * The `/settings/appearance/reset` escape hatch's mutation half (design-system.md
 * §9.2 rule 5) — a real reset, not just a themed page.
 *
 * Two independent actions, gated differently, matching §9.3's own split between what
 * a user controls for themselves and what only an admin controls for the tenant:
 *
 *  - Resetting your OWN preference needs no permission at all — any authenticated
 *    user may always do this (§9.3: "the user, for themselves").
 *  - Resetting the TENANT's applied branding back to the system default is gated by
 *    `appearance:manage` (checked by the caller — an inbound route handler — via
 *    `requirePermission`, the same way every other guarded operation in this codebase
 *    is, per api.md §12 invariant 2. This use case does not check it itself, matching
 *    `ResolveSession`/other application classes that assume the inbound layer already
 *    authorised the call — but see the doc comment on the caller for the explicit
 *    check).
 *
 * Routes the tenant-wide reset through the same `assertContrastPasses` seam a future
 * arbitrary-skin save path will reuse — resetting TO the system default cannot
 * genuinely fail the gate (the shipped skins are asserted contrast-clean at seed
 * time), but running it through the real gate here, rather than skipping it because
 * "the destination is known-good", is what proves the gate is actually IN the apply
 * path and not decorative.
 */

import { resolveSkinTokens, systemSkin } from "@shj3/tokens";
import { assertContrastPasses } from "./appearance-gate.js";
import type { ThemeRepository } from "../ports/theme-repository.js";

export class ResetAppearance {
  constructor(private readonly repo: ThemeRepository) {}

  /** Resets the caller's own `UserThemePreference` to fully defer to the tenant tier. */
  async resetOwnPreference(staffUserId: string): Promise<void> {
    await this.repo.resetUserPreferenceToDefault(staffUserId);
  }

  /**
   * Resets the tenant back to "no tenant branding" (deletes the `TenantBranding`
   * singleton — see the port's own doc comment for why a delete, not a repoint).
   * A no-op if the tenant has no `TenantBranding` row at all — it is already at the
   * system default in every observable sense (§9.3's own resolution destination for
   * "every tenant with no tenant branding").
   */
  async resetTenantBranding(mode: "light" | "dark", updatedByStaffUserId: string): Promise<void> {
    // Real, not decorative: validates that the system default we are falling back to
    // is genuinely safe before falling back to it, through the same seam a future
    // arbitrary-skin save path will reuse (see the module doc comment).
    // resolveSkinTokens (not skin.tokens directly) is what actually returns a
    // complete SemanticColorTokens — a Skin's own .tokens is typed as the narrower
    // SkinTokens (only the 8 required roles are non-optional), correct for the
    // partial-on-import case §7.4 describes but not what a contrast check needs.
    assertContrastPasses(resolveSkinTokens(systemSkin(mode), mode));
    await this.repo.resetTenantBrandingToSystemDefault(updatedByStaffUserId);
  }
}
