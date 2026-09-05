import "server-only";
import { checkContrastRatio } from "@nextbot/tenancy";
import type { TenantBranding } from "@nextbot/contracts";

/**
 * Per-tenant runtime branding (FR-ADM-07), shadcn/Tailwind mechanism.
 *
 * Token contract (Plan Phase 1, `docs/plans/instead-of-chackraui-modify-frolicking-haven.md`;
 * corrected post-QA scope-bug fix, see `docs/plans/chakra-to-shadcn-plan.md`'s
 * addendum): only two CSS custom properties are ever tenant-overridable —
 *   - `--brand-accent` (+ a computed `--brand-accent-foreground`) from
 *     `branding.primaryColor` — a dedicated, chrome-only token, deliberately
 *     *not* shadcn's own `--primary`/`--primary-foreground` (the design system's
 *     default-Button/link/accent tokens, consumed by every shared `Button`/
 *     `Badge`/etc. primitive in `packages/ui`). Overriding `--primary` globally
 *     recolored every button across the whole Admin Console whenever
 *     white-labeling was on — FR-ADM-07 scopes tenant branding to "the top bar
 *     and login screen" only, never the shared component palette. Only chrome
 *     elements (the top-bar accent border, the login screen's sign-in button)
 *     may ever read `--brand-accent`.
 *   - `--brand-sidebar` (a NextBot-only token, deliberately *not* shadcn's own
 *     `--secondary`, so a tenant's brand color can never silently override
 *     NextBot's own neutral/semantic UI colors) from `branding.secondaryColor`
 *
 * This file deliberately lives in `apps/web` rather than `packages/ui` even though
 * the rest of the shadcn component surface lives there: `packages/ui` is a "shared"
 * package under this repo's `eslint-plugin-boundaries` rules (LLD §2.3) and may only
 * depend on other "shared" packages, never on a bounded "module" package like
 * `@nextbot/tenancy` — but reusing `@nextbot/tenancy`'s own
 * `checkContrastRatio` (rather than hand-rolling a second, divergent WCAG
 * algorithm, which the plan explicitly forbids) requires importing from a module.
 * `apps/web` is the composition root and may depend on both, so this utility is
 * placed here instead.
 */

/** Matches `TenantBrandingSchema`'s own hex-color pattern in `packages/contracts`
 * (`^#[0-9a-fA-F]{6}$`) — re-validated here defensively before string-interpolating
 * into a literal `<style>` tag body, since a malformed/legacy row should never be
 * able to inject arbitrary CSS (or break out of the `<style>` element) even though
 * `updateTenantBranding` already validates on write. */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/** The two hex colors chosen as candidate foreground colors for
 * `--primary-foreground` — plain white/black, the only two choices that make sense
 * for arbitrary tenant-chosen brand colors (matches shadcn's own
 * `--primary-foreground` convention of a near-white/near-black pairing). */
const WHITE = "#ffffff";
const BLACK = "#000000";

/**
 * Picks whichever of white/black clears (or comes closer to clearing) the WCAG AA
 * contrast minimum against `background`, using the project's one shared
 * contrast-ratio algorithm (`checkContrastRatio`) — never a second, divergent one.
 *
 * Exported (not module-private) so the public, unauthenticated login-branding
 * lookup route (`app/api/v1/public/tenant-branding/[slug]/route.ts`, FR-ADM-07
 * Part 2) can compute the same `--brand-accent-foreground` pairing server-side
 * for the login screen, rather than hand-rolling a second/divergent copy of this
 * logic or hardcoding a fixed foreground color client-side.
 */
export function pickForegroundForContrast(background: string): string {
  const whiteResult = checkContrastRatio(WHITE, background);
  const blackResult = checkContrastRatio(BLACK, background);
  if (whiteResult.passesAA && !blackResult.passesAA) return WHITE;
  if (blackResult.passesAA && !whiteResult.passesAA) return BLACK;
  // Both (or neither) pass — pick whichever ratio is higher, same tie-break the
  // rest of the codebase would apply for an ambiguous pairing.
  return whiteResult.ratio >= blackResult.ratio ? WHITE : BLACK;
}

/**
 * Builds the literal `:root { ... }` CSS text injected via a server-rendered
 * `<style dangerouslySetInnerHTML>` tag in `(admin)/layout.tsx` — SSR'd, so a
 * branded tenant's chrome renders correctly on the very first paint (no client
 * `useEffect`/FOUC).
 *
 * @param branding the tenant's `branding_config` row, or `null`/`undefined` when
 *   white-labeling is disabled or no profile is configured — returns `null` in that
 *   case (the caller renders no `<style>` tag at all, falling back to the preset's
 *   static tokens).
 */
export function buildBrandStyleTag(branding: TenantBranding | null | undefined): string | null {
  if (!branding) return null;
  if (!HEX_COLOR_RE.test(branding.primaryColor) || !HEX_COLOR_RE.test(branding.secondaryColor)) {
    // Defensive: a malformed row (e.g. from a pre-validation-era migration) must
    // never reach string interpolation into a raw <style> tag.
    return null;
  }

  // Post-QA scope-bug fix: `--brand-accent`, never shadcn's own `--primary` — see
  // this file's header doc comment for why. Reuses the same
  // `pickForegroundForContrast` helper (not a second/divergent one) for the
  // computed foreground pairing.
  const accentForeground = pickForegroundForContrast(branding.primaryColor);

  return `:root{--brand-accent:${branding.primaryColor};--brand-accent-foreground:${accentForeground};--brand-sidebar:${branding.secondaryColor};}`;
}
