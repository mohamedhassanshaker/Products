/**
 * Chakra v3's `Badge`/`Button`/etc. component recipes require a full 50-900 shade ramp for any
 * `colorPalette` they're asked to render with — a single persisted tenant accent hex is only ever
 * ONE shade (conventionally "500"), so this pure function derives the other 8 steps from it at
 * request-render time (migration plan: "`src/components/theme/accent-scale.ts` derives a Chakra-
 * required 50-900 shade ramp from the single persisted accent hex at runtime").
 *
 * Pure, zero-framework-dependency math (HSL lightness interpolation, hue/saturation held constant) —
 * deliberately mirrors `color-contrast.ts`'s own "pure function module" discipline so this is
 * trivially unit-testable and never accidentally depends on request context.
 */

/** The 9 Chakra-conventional shade steps every color palette needs. */
export const ACCENT_SCALE_STEPS = ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900'] as const;
export type AccentScaleStep = (typeof ACCENT_SCALE_STEPS)[number];

/** A fully-derived 50-900 ramp, each value a 6-digit hex string with a leading `#`. */
export type AccentScale = Record<AccentScaleStep, string>;

const HEX_PATTERN = /^[0-9A-Fa-f]{6}$/;

/**
 * Per-step blend weight towards white (steps lighter than 500) or black (steps darker than 500) —
 * monotonically increasing with distance from 500 in both directions, so the resulting ramp is
 * guaranteed monotonic in lightness regardless of the base color (unit-tested below/`.test.ts`).
 * `500` itself is always the exact, unmodified base color (weight 0).
 */
const TINT_WEIGHTS: Record<'50' | '100' | '200' | '300' | '400', number> = {
  50: 0.95,
  100: 0.85,
  200: 0.65,
  300: 0.45,
  400: 0.22,
};
const SHADE_WEIGHTS: Record<'600' | '700' | '800' | '900', number> = {
  600: 0.18,
  700: 0.36,
  800: 0.56,
  900: 0.76,
};

function hexToRgb(hex: string): [number, number, number] {
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16)];
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  const toHex = (n: number) => clamp(n).toString(16).padStart(2, '0').toUpperCase();
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Linearly interpolates each RGB channel `weight` of the way from `base` towards `target`
 * (`target = [255,255,255]` for a tint, `[0,0,0]` for a shade) — a simple, deterministic, order-
 * preserving blend; not a perceptual (Lab/LCH) interpolation, which this app's scope doesn't need. */
function blend(base: [number, number, number], target: [number, number, number], weight: number): [number, number, number] {
  return [
    base[0] + (target[0] - base[0]) * weight,
    base[1] + (target[1] - base[1]) * weight,
    base[2] + (target[2] - base[2]) * weight,
  ];
}

/**
 * Derives the full 50-900 ramp from a single base hex (conventionally the "500" shade).
 *
 * @param baseHex A 6-digit hex string, with or without a leading `#`. Deliberately does NOT go
 *   through `color-contrast.ts`'s `normalizeHex` (which throws `InvalidColorFormatError`, a
 *   client-facing `DomainError`) — this is a rendering-time helper, not a validation boundary; an
 *   already-invalid value should never reach here (it would have been rejected at
 *   `TenantsService.updateBranding` write time), so this function throws a plain `Error` for a
 *   malformed input as a defensive assertion, not a condition callers are expected to handle per-call.
 */
export function deriveAccentScale(baseHex: string): AccentScale {
  const stripped = baseHex.trim().replace(/^#/, '');
  if (!HEX_PATTERN.test(stripped)) {
    throw new Error(`deriveAccentScale: '${baseHex}' is not a valid 6-digit hex color.`);
  }
  const base = hexToRgb(stripped.toUpperCase());

  const scale: Partial<AccentScale> = { 500: rgbToHex(...base) };
  for (const [step, weight] of Object.entries(TINT_WEIGHTS) as [keyof typeof TINT_WEIGHTS, number][]) {
    scale[step] = rgbToHex(...blend(base, [255, 255, 255], weight));
  }
  for (const [step, weight] of Object.entries(SHADE_WEIGHTS) as [keyof typeof SHADE_WEIGHTS, number][]) {
    scale[step] = rgbToHex(...blend(base, [0, 0, 0], weight));
  }
  return scale as AccentScale;
}

/**
 * Renders {@link deriveAccentScale}'s output as a flat map of CSS custom-property name -> value,
 * ready to spread onto an inline `style` object (e.g. the root `<html>` element) —
 * `--brand-accent-50` .. `--brand-accent-900`, plus the bare `--brand-accent` alias for the exact
 * base/500 value (migration plan: "base 500 = `var(--brand-accent)`" — kept as its own named
 * variable, not merely `--brand-accent-500`, since it's referenced directly by name from
 * `components/theme/system.ts`'s `brand.500` token and various one-off inline styles that predate
 * the full ramp).
 */
export function accentScaleToCssVars(scale: AccentScale): Record<string, string> {
  const vars: Record<string, string> = { '--brand-accent': scale['500'] };
  for (const step of ACCENT_SCALE_STEPS) {
    vars[`--brand-accent-${step}`] = scale[step];
  }
  return vars;
}
