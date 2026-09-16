/**
 * §12.4's first contrast suite: the shipped skins against the pair matrix the
 * runtime gate uses.
 *
 * Two things are asserted, and they fail for different reasons:
 *
 *  1. **The published ratios reproduce.** §4 and §8 print a measured ratio for
 *     every pair. Those numbers are load-bearing documentation — a reviewer
 *     reads them instead of recomputing — so the test asserts them to the
 *     decimal place they are published at. A drift in a token value or in the
 *     luminance formula fails here, which is what stops the document decaying
 *     into fiction (§12.6 step 8).
 *  2. **Both skins pass AA.** Not a smoke test: §6.3 records that the
 *     wireframe's palette, taken literally, fails AA for status *text* while
 *     passing for the fill behind it. That is the exact bug class this module
 *     exists to prevent, so it is encoded as a test rather than a comment.
 */

import { describe, expect, it } from "vitest";
import {
  AA_NON_TEXT_RATIO,
  AA_TEXT_RATIO,
  checkContrast,
  contrastRatio,
  CONTRAST_PAIRS,
  EXEMPT_COLOR_TOKENS,
  InvalidColorError,
  relativeLuminance,
  roundRatio,
} from "./contrast.js";
import { primitives } from "./primitives.js";
import { SEMANTIC_COLOR_TOKEN_NAMES, semanticColors } from "./semantic.js";
import type { ColorMode, SemanticColorTokenName } from "./semantic.js";
import { resolveSkinTokens } from "./skin.js";
import { SHARJAH_DARK, SHARJAH_DEFAULT } from "./skins/index.js";
import type { Skin } from "./skin.js";

type DocumentedRatio = readonly [SemanticColorTokenName, SemanticColorTokenName, number];

/** §8.1 — Sharjah Default, text pairs (require >= 4.5:1, blocking). */
const DEFAULT_TEXT_RATIOS: readonly DocumentedRatio[] = [
  ["foreground", "background", 14.27],
  ["cardForeground", "card", 15.57],
  ["popoverForeground", "popover", 15.57],
  ["mutedForeground", "background", 5.62],
  ["mutedForeground", "card", 6.13],
  ["mutedForeground", "muted", 5.24],
  ["primary", "background", 5.52],
  ["primary", "card", 6.02],
  ["primaryForeground", "primary", 6.02],
  ["secondaryForeground", "secondary", 13.3],
  ["accentForeground", "accent", 6.86],
  ["successForeground", "success", 6.02],
  ["successStrong", "successSubtle", 6.86],
  ["warningForeground", "warning", 5.91],
  ["warningStrong", "warningSubtle", 6.93],
  ["destructiveForeground", "destructive", 4.87],
  ["destructiveStrong", "destructiveSubtle", 5.16],
  ["destructiveStrong", "background", 5.88],
  ["infoForeground", "info", 6.64],
  ["infoStrong", "infoSubtle", 7.03],
  ["chatUserBubbleForeground", "chatUserBubble", 12.89],
  ["chatAssistantBubbleForeground", "chatAssistantBubble", 13.33],
  ["chatMetaForeground", "chatUserBubble", 5.08],
  ["chatMetaForeground", "chatAssistantBubble", 5.25],
  ["chatDisclaimerForeground", "chatDisclaimer", 5.24],
  ["sidebarForeground", "sidebar", 13.3],
  ["sidebarMutedForeground", "sidebar", 5.24],
  ["sidebarForeground", "sidebarActiveSurface", 12.86],
  ["codeForeground", "codeSurface", 13.3],
  ["selectionForeground", "selection", 12.86],
  ["chart1", "card", 6.02],
  ["chart2", "card", 6.64],
  ["chart3", "card", 5.91],
  ["chart4", "card", 4.87],
  ["chart5", "card", 6.13],
  ["chart6", "card", 6.85],
];

/** §8.1 — Sharjah Default, non-text pairs (require >= 3:1, warn only). */
const DEFAULT_NON_TEXT_RATIOS: readonly DocumentedRatio[] = [
  ["borderStrong", "background", 3.12],
  ["borderStrong", "card", 3.4],
  ["ring", "background", 5.52],
  ["ring", "card", 6.02],
];

/** §8.2 — Sharjah Dark, text pairs. */
const DARK_TEXT_RATIOS: readonly DocumentedRatio[] = [
  ["foreground", "background", 15.47],
  ["cardForeground", "card", 14.24],
  ["popoverForeground", "popover", 13.26],
  ["mutedForeground", "background", 7.59],
  ["mutedForeground", "card", 6.99],
  ["mutedForeground", "muted", 6.26],
  ["primary", "background", 7.34],
  ["primary", "card", 6.75],
  ["primaryForeground", "primary", 7.34],
  ["secondaryForeground", "secondary", 12.76],
  ["accentForeground", "accent", 8.39],
  ["successForeground", "success", 7.34],
  ["successStrong", "successSubtle", 8.39],
  ["warningForeground", "warning", 8.11],
  ["warningStrong", "warningSubtle", 6.35],
  ["destructiveForeground", "destructive", 6.88],
  ["destructiveStrong", "destructiveSubtle", 8.31],
  ["infoForeground", "info", 7.37],
  ["infoStrong", "infoSubtle", 6.13],
  ["chatUserBubbleForeground", "chatUserBubble", 10.59],
  ["chatAssistantBubbleForeground", "chatAssistantBubble", 12.26],
  ["chatMetaForeground", "chatUserBubble", 5.2],
  ["chatMetaForeground", "chatAssistantBubble", 6.02],
  ["chatDisclaimerForeground", "chatDisclaimer", 6.26],
  ["sidebarForeground", "sidebar", 15.19],
  ["codeForeground", "codeSurface", 16.04],
  ["sidebarMutedForeground", "sidebar", 7.46],
  ["sidebarForeground", "sidebarActiveSurface", 12.65],
  ["chart1", "card", 6.75],
  ["chart2", "card", 6.78],
  ["chart3", "card", 7.46],
  ["chart4", "card", 6.33],
  ["chart5", "card", 6.99],
  ["chart6", "card", 6.17],
];

/** §8.2 — Sharjah Dark, non-text pairs. */
const DARK_NON_TEXT_RATIOS: readonly DocumentedRatio[] = [
  ["borderStrong", "background", 3.71],
  ["borderStrong", "card", 3.41],
  ["ring", "background", 8.76],
  ["disabledForeground", "disabledSurface", 3.61],
];

const SKINS: readonly { readonly name: string; readonly skin: Skin; readonly mode: ColorMode }[] = [
  { name: "Sharjah Default", skin: SHARJAH_DEFAULT, mode: "light" },
  { name: "Sharjah Dark", skin: SHARJAH_DARK, mode: "dark" },
];

describe("relative luminance and contrast ratio", () => {
  it("anchors at the ends of the scale", () => {
    expect(relativeLuminance("#FFFFFF")).toBe(1);
    expect(relativeLuminance("#000000")).toBe(0);
    expect(roundRatio(contrastRatio("#FFFFFF", "#000000"))).toBe(21);
  });

  it("is order-independent", () => {
    expect(contrastRatio("#20242B", "#F6F5F1")).toBe(contrastRatio("#F6F5F1", "#20242B"));
  });

  it("refuses anything that is not a 6-digit hex colour", () => {
    // The narrow input type is the same control that keeps a hostile value out
    // of a <style> block (§7.2), so it is asserted here too.
    expect(() => relativeLuminance("#FFF")).toThrow(InvalidColorError);
    expect(() => relativeLuminance("rgb(255 255 255)")).toThrow(InvalidColorError);
    expect(() => relativeLuminance("white")).toThrow(InvalidColorError);
  });
});

const DOCUMENTED_RATIOS = [
  {
    name: "Sharjah Default",
    mode: "light",
    pairs: [...DEFAULT_TEXT_RATIOS, ...DEFAULT_NON_TEXT_RATIOS],
  },
  { name: "Sharjah Dark", mode: "dark", pairs: [...DARK_TEXT_RATIOS, ...DARK_NON_TEXT_RATIOS] },
] as const satisfies readonly {
  readonly name: string;
  readonly mode: ColorMode;
  readonly pairs: readonly DocumentedRatio[];
}[];

for (const { name, mode, pairs } of DOCUMENTED_RATIOS) {
  describe(`${name} reproduces the ratios design-system.md §8 publishes`, () => {
    const tokens = semanticColors[mode];

    for (const [fg, bg, expected] of pairs) {
      it(`${fg} on ${bg} is ${expected}:1`, () => {
        expect(roundRatio(contrastRatio(tokens[fg], tokens[bg]))).toBe(expected);
      });
    }
  });
}

describe("the shipped skins meet WCAG 2.1 AA", () => {
  for (const { name, skin, mode } of SKINS) {
    describe(name, () => {
      const report = checkContrast(resolveSkinTokens(skin, mode));

      it("has no blocking failure", () => {
        expect(
          report.blockers.map((b) => `${b.pair.fg} on ${b.pair.bg} = ${roundRatio(b.ratio)}`),
        ).toEqual([]);
      });

      it("has no non-text warning either", () => {
        expect(
          report.warnings.map((w) => `${w.pair.fg} on ${w.pair.bg} = ${roundRatio(w.ratio)}`),
        ).toEqual([]);
      });

      it("checks every pair in the matrix", () => {
        expect(report.checks).toHaveLength(CONTRAST_PAIRS.length);
        expect(report.passed).toBe(true);
      });
    });
  }
});

describe("§6.3 — why every status family needs a -strong text variant", () => {
  const paper = primitives.paper;

  it("the wireframe attention colour fails AA as text on paper", () => {
    // 4.46:1 — the finding that produced the fill/text split. If this ever
    // starts passing, the formula changed, not the palette.
    expect(roundRatio(contrastRatio(primitives.rust600, paper))).toBe(4.46);
    expect(contrastRatio(primitives.rust600, paper)).toBeLessThan(AA_TEXT_RATIO);
  });

  it("but passes as a fill with white text on it", () => {
    expect(roundRatio(contrastRatio(primitives.panel, primitives.rust600))).toBe(4.87);
    expect(contrastRatio(primitives.panel, primitives.rust600)).toBeGreaterThanOrEqual(
      AA_TEXT_RATIO,
    );
  });

  it("and the -strong variant is what makes the label legible", () => {
    expect(roundRatio(contrastRatio(primitives.rust700, paper))).toBe(5.88);
    expect(contrastRatio(primitives.rust700, paper)).toBeGreaterThanOrEqual(AA_TEXT_RATIO);
  });

  it("blocks a skin that uses the fill hue as its status text colour", () => {
    // The naive palette: one rust token serving as both fill and label. This is
    // precisely the skin an admin would build from the wireframe by hand.
    const naive = {
      ...semanticColors.light,
      destructiveStrong: primitives.rust600,
    };
    const report = checkContrast(naive);

    expect(report.passed).toBe(false);
    expect(
      report.blockers.some((b) => b.pair.fg === "destructiveStrong" && b.pair.bg === "background"),
    ).toBe(true);
  });
});

describe("the pair matrix cannot fall behind the token set (§10.2, §12.4)", () => {
  it("covers every colour role by a pair or a named exemption", () => {
    const paired = new Set<string>();
    for (const pair of CONTRAST_PAIRS) {
      paired.add(pair.fg);
      paired.add(pair.bg);
    }

    const uncovered = SEMANTIC_COLOR_TOKEN_NAMES.filter(
      (token) => !paired.has(token) && !EXEMPT_COLOR_TOKENS.has(token),
    );

    expect(uncovered).toEqual([]);
  });

  it("does not exempt a token it also gates", () => {
    for (const pair of CONTRAST_PAIRS) {
      // An exemption plus a pair means the report says "skipped" about
      // something it measured — the reader cannot tell which is true.
      expect(EXEMPT_COLOR_TOKENS.has(pair.fg)).toBe(false);
      expect(EXEMPT_COLOR_TOKENS.has(pair.bg)).toBe(false);
    }
  });

  it("applies the AA thresholds ADR-0007 names, blocking text and warning non-text", () => {
    for (const check of checkContrast(semanticColors.light).checks) {
      if (check.pair.class === "non-text") {
        expect(check.required).toBe(AA_NON_TEXT_RATIO);
        expect(check.blocking).toBe(false);
      } else {
        expect(check.blocking).toBe(true);
      }
    }
  });
});
