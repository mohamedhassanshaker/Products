/**
 * WCAG 2.2 AA contrast-ratio checker (FR-ADM-07 / NFR-7). Pure, dependency-free
 * implementation of the standard relative-luminance formula — no need for a new
 * dependency (`§3`'s ADR maturity-bar check would apply to any color library added
 * just for this), and this is exactly the kind of "structurally reasonable, not
 * exhaustively pedantic" validation the project's own convention already applies to
 * `formats.ts`'s hand-rolled email/uri format checks.
 *
 * Reference: WCAG 2.x "contrast (minimum)" success criterion 1.4.3 (AA) — ratio
 * (L1 + 0.05) / (L2 + 0.05) where L1 is the lighter of the two relative luminances.
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
 * Computes the WCAG contrast ratio between two hex colors (e.g. a button's text
 * color against its background) and whether it clears the AA minimum.
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
