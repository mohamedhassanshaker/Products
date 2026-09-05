import { InsufficientColorContrastError, InvalidColorFormatError } from './errors';

/**
 * FR-MT-10 / LLD §9.11 — the sole place accent-color contrast math happens. A pure function module
 * (no I/O, no framework dependency) so it is trivially unit-testable at exact WCAG boundary values and
 * can never accidentally depend on request context. Ported verbatim from
 * `legacy/api/src/platform/tenants/domain/color-contrast.ts` (migration plan: "`color-contrast.ts`
 * ports verbatim — pure functions, zero framework dependency").
 */

const HEX_PATTERN = /^[0-9A-F]{6}$/;

/**
 * Strips an optional leading `#` and uppercases, then validates the result is exactly 6 hex digits.
 * This is the *only* place a client-supplied color string is parsed — every caller (branding write,
 * tests) must go through this before storing/comparing a color.
 *
 * @throws {InvalidColorFormatError} if, after stripping `#` and trimming, the value isn't exactly
 *   6 hexadecimal digits (`FR-MT-10`: "a malformed hex value is rejected with `INVALID_COLOR_FORMAT`").
 */
export function normalizeHex(input: string): string {
  const stripped = input.trim().replace(/^#/, '').toUpperCase();
  if (!HEX_PATTERN.test(stripped)) {
    throw new InvalidColorFormatError();
  }
  return stripped;
}

/**
 * WCAG 2.x relative luminance: sRGB channels are linearized (the standard gamma-decoding piecewise
 * function), then combined with the ITU-R BT.709 luminance coefficients
 * (`0.2126R + 0.7152G + 0.0722B`) per the WCAG formula (not a naive average — green is weighted
 * heaviest because the human eye is most sensitive to it).
 *
 * @param hex A 6-digit hex string, already normalized (no `#`, uppercase) — callers here are always
 *   internal to this module or a caller that has already gone through {@link normalizeHex}.
 */
export function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const linearize = (channel: number) =>
    channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
  const [rl, gl, bl] = [linearize(r), linearize(g), linearize(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/**
 * WCAG contrast ratio between two colors: `(Llighter + 0.05) / (Ldarker + 0.05)`, always ≥ 1 —
 * order-independent since the lighter/darker roles are resolved internally rather than assumed from
 * argument position.
 */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Inputs the contrast validator checks a candidate accent against — the two published FR-MT-10
 * surface anchors (`THEME_SURFACE_LIGHT`/`THEME_SURFACE_DARK` env config) and the WCAG 2.2 AA
 * non-text minimum ratio. */
export interface ContrastValidationConfig {
  surfaceLight: string;
  surfaceDark: string;
  minRatio: number;
}

/**
 * FR-MT-10's full accent-override validation: the hex must be well-formed, then its contrast against
 * *both* the light and dark surface anchors must meet `cfg.minRatio` (WCAG 2.2 AA ≥3:1 for
 * non-text/large-scale UI components). Whichever surface is worse is the one reported — a color is
 * either fully acceptable or rejected outright; there is no partial/clamped acceptance.
 *
 * @throws {InvalidColorFormatError} via {@link normalizeHex} if `hex` isn't a valid 6-digit color.
 * @throws {InsufficientColorContrastError} if either surface's ratio is below `cfg.minRatio` — always
 *   reports the *worse* (lower-ratio) surface, ratio rounded to 2 decimal places for an actionable
 *   message (LLD §9.11: "the ratio is reported rounded to 2 dp").
 * @returns The normalized (no `#`, uppercase) hex value, for the caller to persist.
 */
export function validateAccent(hex: string, cfg: ContrastValidationConfig): string {
  const normalized = normalizeHex(hex);
  const lightRatio = contrastRatio(normalized, normalizeHex(cfg.surfaceLight));
  const darkRatio = contrastRatio(normalized, normalizeHex(cfg.surfaceDark));

  // Report whichever surface is the worse (lower-ratio) failure — a color that fails both surfaces
  // still gets one specific, actionable message rather than two, matching LLD §9.11's shape.
  const [worstRatio, failingSurface]: [number, 'light' | 'dark'] =
    lightRatio <= darkRatio ? [lightRatio, 'light'] : [darkRatio, 'dark'];

  if (worstRatio < cfg.minRatio) {
    throw new InsufficientColorContrastError({
      ratio: Math.round(worstRatio * 100) / 100,
      required: cfg.minRatio,
      failingSurface,
    });
  }

  return normalized;
}
