/**
 * WCAG 2.2 AA contrast-ratio checker (FR-ADM-07 / NFR-7) — pure, dependency-free
 * implementation of the standard relative-luminance formula, **intentionally
 * duplicated** (not imported) from `packages/modules/tenancy/src/domain/
 * contrast-checker.ts` rather than a shared import.
 *
 * Why duplicated instead of imported (documented, per this project's "don't
 * invent a second algorithm" rule — this is the one deliberate, narrow exception):
 * `apps/widget-embed` is a pure client-side Vite SPA (no Node runtime backs this
 * bundle — it ships to the browser inside an iframe). `@nextbot/tenancy` is a
 * server-side module package whose barrel (`src/index.ts`) transitively imports
 * `@nextbot/db` (`drizzle-orm`/`pg`) and `ioredis` — both Node-only and unusable in
 * a browser bundle. Importing the module directly (even just this one pure
 * function) would drag that whole dependency graph into `vite build`'s static
 * module graph. This is the exact same reasoning `theme.ts` already documented for
 * why the widget never imports `@nextbot/ui`'s Chakra-era theme bundle either —
 * carried forward here for the same "widget never depends on a server-only/
 * Next.js-only bundle" boundary. The algorithm itself is copied verbatim (same
 * WCAG 2.x "contrast (minimum)" success criterion 1.4.3 formula) — if the source
 * of truth ever changes, this copy must be updated to match.
 */

/** AA minimum for normal-size text/UI foreground-on-background pairs. */
export const MIN_AA_CONTRAST_RATIO = 4.5;

export interface ContrastCheckResult {
  ratio: number;
  passesAA: boolean;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const r = parseInt(clean.slice(0, 2), 16);
  const g = parseInt(clean.slice(2, 4), 16);
  const b = parseInt(clean.slice(4, 6), 16);
  return [r, g, b];
}

function channelToLinear(c: number): number {
  const srgb = c / 255;
  return srgb <= 0.03928 ? srgb / 12.92 : Math.pow((srgb + 0.055) / 1.055, 2.4);
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const [rl, gl, bl] = [channelToLinear(r), channelToLinear(g), channelToLinear(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * Computes the WCAG contrast ratio between two hex colors (e.g. a tenant's brand
 * color against white/black candidate text) and whether it clears the AA minimum.
 *
 * @param foreground `#rrggbb` hex color.
 * @param background `#rrggbb` hex color.
 * @param minRatio override the AA minimum (e.g. `3` for large text/UI components) —
 *   defaults to the normal-text AA threshold.
 */
export function checkContrastRatio(foreground: string, background: string, minRatio: number = MIN_AA_CONTRAST_RATIO): ContrastCheckResult {
  const l1 = relativeLuminance(foreground);
  const l2 = relativeLuminance(background);
  const [lighter, darker] = l1 >= l2 ? [l1, l2] : [l2, l1];
  const ratio = (lighter + 0.05) / (darker + 0.05);
  return { ratio: Math.round(ratio * 100) / 100, passesAA: ratio >= minRatio };
}
