/**
 * Shared, pre-verified-contrast Tailwind class strings for the "solid background +
 * white text" status Badge convention used across the admin screens (status badges
 * on `ConversationDetail`, `TakeoverPanel`, `DefinitionDetail`, `McpHealthDashboard`,
 * etc. — anywhere a status needs a hue beyond the Badge primitive's four built-in
 * variants).
 *
 * QA (Batch D retry 1) found `bg-amber-600 text-white` — independently re-typed as a
 * literal string in four separate screens — measures ~3.19:1 contrast, short of
 * WCAG AA's 4.5:1 minimum for normal-weight small text. `WARNING_BADGE_CLASS` below
 * is the amber replacement (verified below); every screen needing an amber/"warning"
 * status badge should import this constant rather than re-typing the Tailwind class,
 * so a future screen can't reintroduce the same failing pairing from memory.
 *
 * Contrast verified via the WCAG relative-luminance formula (sRGB-linearized,
 * `(L_lighter + 0.05) / (L_darker + 0.05)`) against white (#ffffff) foreground text:
 *   - bg-amber-600 (#d97706): ~3.19:1 — FAILS AA (this is what QA measured/flagged).
 *   - bg-amber-700 (#b45309): ~5.02:1 — passes AA, but with a thin ~12% margin.
 *   - bg-amber-800 (#92400e): ~7.09:1 — passes AA with a comfortable margin; chosen
 *     here so minor rendering differences (anti-aliasing, subpixel rounding) can
 *     never push the effective ratio back under 4.5:1.
 */
export const WARNING_BADGE_CLASS = "bg-amber-800 text-white" as const;

/**
 * Plan Phase 4 (`StatusBadge.tsx` rebuild): extends the same "solid, pre-verified
 * pairing" convention to the remaining status tones `StatusBadge`'s `StatusTone`
 * union needs (`connected`/`degraded`/`offline`/`neutral`), so this file becomes the
 * single source of truth for status-color Tailwind classes across the admin console
 * — any other screen rendering a connector/breaker/connection status badge (e.g.
 * `McpHealthDashboard.tsx`'s `Connected`/`Closed` rows, which already independently
 * arrived at the same `bg-emerald-700 text-white` pairing) should reference these
 * constants going forward instead of re-typing the literal class string.
 *
 * `CONNECTED_BADGE_CLASS` reuses the exact `bg-emerald-700 text-white` pairing
 * `McpHealthDashboard.tsx`/`TakeoverPanel.tsx` already ship (not independently
 * re-verified here — those screens' own contrast checks already cover it).
 * `DEGRADED_BADGE_CLASS` is `WARNING_BADGE_CLASS` itself (same amber tone, same
 * verified ~7.09:1 ratio) — kept as a separate named export so a status-tone call
 * site reads by its semantic meaning ("degraded") rather than the generic
 * "warning" name. `offline`/`neutral` reuse the Badge primitive's own built-in
 * `destructive`/`secondary` variants directly (both already independently
 * contrast-verified — see `badge.tsx`'s own doc comments) rather than a new literal
 * class, so there is exactly one place either is defined.
 */
export const CONNECTED_BADGE_CLASS = "bg-emerald-700 text-white" as const;
export const DEGRADED_BADGE_CLASS = WARNING_BADGE_CLASS;

/**
 * Small, non-text status dot fill colors (paired with a text label in
 * `StatusBadge.tsx` — "never convey status by color alone"). WCAG's non-text
 * contrast requirement is 3:1 (not the 4.5:1 text requirement the badge-class
 * constants above satisfy), so these can safely use the same mid-tone hues the
 * text-pairing constants above deliberately avoid (e.g. `amber-600`, which fails
 * as a *text* background per `WARNING_BADGE_CLASS`'s doc comment, but comfortably
 * clears 3:1 as a small solid dot against the badge's light background).
 */
export const STATUS_DOT_CLASS: Record<"connected" | "degraded" | "offline" | "neutral", string> = {
  connected: "bg-emerald-600",
  degraded: "bg-amber-600",
  offline: "bg-red-600",
  neutral: "bg-muted-foreground",
};
