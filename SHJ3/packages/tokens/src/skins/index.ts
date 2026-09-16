/**
 * The shipped skins (`design-system.md` §8).
 *
 * Both are read-only, live in the `platform` schema, and are the last link in
 * the resolution chain (§9.4). They are also the fixtures for §12.4's contrast
 * suite — the test asserts the exact ratios §8 publishes, so a value cannot
 * drift unnoticed.
 */

import type { ColorMode } from "../semantic.js";
import type { Skin } from "../skin.js";
import { SHARJAH_DARK } from "./sharjah-dark.js";
import { SHARJAH_DEFAULT } from "./sharjah-default.js";

export { SHARJAH_DARK } from "./sharjah-dark.js";
export { SHARJAH_DEFAULT } from "./sharjah-default.js";

/** Keyed by resolved mode, which is how `resolveTheme` reaches for a fallback (§9.4). */
export const SHIPPED_SKINS: Readonly<Record<ColorMode, Skin>> = {
  light: SHARJAH_DEFAULT,
  dark: SHARJAH_DARK,
} as const;

/** The system default for a resolved mode — step 1 of §9.4's per-token merge. */
export function systemSkin(mode: ColorMode): Skin {
  return SHIPPED_SKINS[mode];
}
