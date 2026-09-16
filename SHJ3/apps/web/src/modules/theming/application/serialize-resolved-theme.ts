/**
 * Turn a `ResolvedTheme` into the `<style id="shj3-theme">` body (design-system.md
 * §9.4). Mirrors `@shj3/tokens`' own `serializeBaseStylesheet(mode)` structurally —
 * same three layers, same density stops, same reduced-motion media query — but with
 * the *colour* portion of the semantic layer coming from `theme.colorTokens` (the
 * merged, per-token result) instead of `semanticColors[mode]`'s static value.
 *
 * Deliberately not added to `@shj3/tokens` itself: that package has no notion of a
 * per-tenant/per-user resolved theme, only static layers — this is theming-specific
 * assembly, and adding an override parameter to `serializeBaseStylesheet` for a
 * single caller would widen a already-tested, already-verified package's contract
 * for a concern that belongs one layer up.
 *
 * Every value still passes `assertSafeCssValue` at emit time (`serializeTokens`
 * itself, called here exactly as `serializeBaseStylesheet` calls it) — defence in
 * depth holds even though `theme.colorTokens` is already a merge of trusted sources
 * (the system default, a validated tenant skin, a validated personal skin).
 */

import {
  DENSITY_SCALE,
  REDUCED_MOTION_OVERRIDES,
  SHADOW_COLOR_BY_MODE,
  motion,
  radius,
  serializeComponentLayer,
  serializePrimitiveLayer,
  serializeTokens,
  shadow,
  spacing,
  typography,
  zIndex,
  type SerializeOptions,
} from "@shj3/tokens";
import type { ResolvedTheme } from "../domain/theme.js";

export function serializeResolvedTheme(
  theme: ResolvedTheme,
  options: SerializeOptions = {},
): string {
  const semanticLayer = serializeTokens(
    {
      ...theme.colorTokens,
      ...typography,
      ...spacing,
      ...radius,
      ...shadow,
      shadowColor: SHADOW_COLOR_BY_MODE[theme.mode],
      ...zIndex,
      ...motion,
    },
    options,
  );

  const density = Object.entries(DENSITY_SCALE).map(([name, value]) =>
    serializeTokens({ densityScale: value }, { ...options, selector: `[data-density="${name}"]` }),
  );
  const reducedMotionMediaQuery = serializeTokens(REDUCED_MOTION_OVERRIDES, options);
  const separator = options.minify ? "" : "\n\n";

  const layers = [
    serializePrimitiveLayer(options),
    semanticLayer,
    serializeComponentLayer(options),
    ...density,
    `@media (prefers-reduced-motion: reduce) {${separator}${reducedMotionMediaQuery}${separator}}`,
  ];

  // The user's explicit reduced-motion preference (UserThemePreference.reducedMotion
  // — has no tenant tier, §9.3) must win regardless of their OS-level setting, which
  // the media query alone cannot express. Emitted last, unlayered like everything
  // else here, so equal-specificity `:root` wins over the media query's own values
  // whenever the query also happens to match.
  if (theme.reducedMotion) {
    layers.push(serializeTokens(REDUCED_MOTION_OVERRIDES, options));
  }

  return layers.join(separator);
}
