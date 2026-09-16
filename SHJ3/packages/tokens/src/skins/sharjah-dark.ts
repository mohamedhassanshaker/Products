/**
 * Sharjah Dark — the shipped dark skin (`design-system.md` §8.2).
 *
 * Not an inversion. Surfaces are desaturated blue-slate rather than pure black,
 * because pure black behind a 14px UI produces halation; the brand green lifts
 * to `#4FB79B` so it survives on a dark ground; and the shadow colour deepens
 * (§4.8), which `semanticTokens("dark")` handles through `--shadow-color`
 * rather than through this document.
 *
 * Geometry and typography are identical to the light skin on purpose: mode is
 * not a licence to change the layout, and §9.2 rule 6 requires the two mode
 * token sets to be edited separately but saved together.
 */

import { semanticColors } from "../semantic.js";
import type { Skin } from "../skin.js";

export const SHARJAH_DARK: Skin = {
  schemaVersion: 1,
  metadata: {
    name: "Sharjah Dark",
    author: "Platform",
    createdAt: "2026-09-08T00:00:00Z",
    readOnly: true,
  },
  mode: "dark",
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
  tokens: semanticColors.dark,
};
