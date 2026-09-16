/**
 * Sharjah Default — the shipped light skin (`design-system.md` §8.1).
 *
 * Takes the wireframe's §7.2 palette as its base and extends it with the
 * semantic families the 14 admin screens need (§4.3). It is `readOnly`, lives
 * in the `platform` schema, and is the fallback at the end of the resolution
 * chain user → tenant → system (§9.4).
 *
 * The token values are `semanticColors.light` rather than a second copy of
 * §8.1's JSON. §4 states that its Light column *is* this skin, so the two
 * cannot be allowed to drift; §12.4's contrast suite asserts §8.1's published
 * ratios against whatever this resolves to, which is what makes the identity
 * checkable rather than asserted.
 */

import { semanticColors } from "../semantic.js";
import type { Skin } from "../skin.js";

export const SHARJAH_DEFAULT: Skin = {
  schemaVersion: 1,
  metadata: {
    name: "Sharjah Default",
    author: "Platform",
    createdAt: "2026-09-08T00:00:00Z",
    readOnly: true,
  },
  mode: "light",
  direction: "locale",
  assets: { appTitle: "SHJ3 Assistant" },
  typography: {
    fontSans: "ibm-plex-sans",
    fontMono: "ibm-plex-mono",
    fontArabic: "ibm-plex-sans-arabic",
    baseSize: "0.875rem",
    scaleRatio: 1.2,
    baseWeight: 400,
  },
  geometry: {
    radiusRoot: "0.5rem",
    density: "comfortable",
    shadowDepth: 1,
    sidebarStyle: "neutral",
    sidebarWidth: "16rem",
  },
  tokens: semanticColors.light,
};
