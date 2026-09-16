/**
 * WCAG 2.1 contrast computation and the save-time gate
 * (`design-system.md` §10.2, §6.3; ADR-0007's accessibility gate).
 *
 * ADR-0007 hardens Phase E's contrast *warning* into a *block* for text pairs,
 * "because a government service that ships an unreadable tenant theme has a
 * legal exposure, not a cosmetic one". This module is where that block is
 * computed, and it runs on the same pair matrix for a theme save, a skin import
 * (§7.4 stage 5) and the shipped-skin regression suite (§12.4) — one
 * implementation, so the tests cannot pass while the runtime gate differs.
 *
 * The reason the module exists at all is §6.3's finding: the wireframe's own
 * attention colour `#B4553F` measures 4.87:1 as a fill with white text on it
 * and only 4.46:1 as text on paper. Taken literally, the wireframe's palette
 * fails AA for the word "Failed" while passing for the badge behind it. That is
 * not visible to review and it is trivially visible to arithmetic, which is why
 * every status family carries both a fill and a `-strong` text variant.
 */

import { isHexColor } from "./css.js";
import type { SemanticColorTokenName, SemanticColorTokens } from "./semantic.js";
import { CONTRAST_PAIRS } from "./contrast-pairs.js";

/** Normal-size text (WCAG 1.4.3). Blocks a save. */
export const AA_TEXT_RATIO = 4.5;
/** Text at or above 24px, or 18.66px bold (WCAG 1.4.3). Blocks a save. */
export const AA_LARGE_TEXT_RATIO = 3;
/** Control boundaries, state indicators and meaningful graphics (WCAG 1.4.11). Warns. */
export const AA_NON_TEXT_RATIO = 3;

export type ContrastPairClass = "text" | "large-text" | "non-text";

export interface ContrastPair {
  readonly fg: SemanticColorTokenName;
  readonly bg: SemanticColorTokenName;
  readonly class: ContrastPairClass;
  /** Why this pair is in the matrix — the surface the token is actually drawn on. */
  readonly note: string;
}

export function thresholdFor(pairClass: ContrastPairClass): number {
  switch (pairClass) {
    case "text":
      return AA_TEXT_RATIO;
    case "large-text":
      return AA_LARGE_TEXT_RATIO;
    case "non-text":
      return AA_NON_TEXT_RATIO;
  }
}

/** A text pair blocks the save; a non-text pair warns (ADR-0007). */
export function isBlocking(pairClass: ContrastPairClass): boolean {
  return pairClass !== "non-text";
}

export class InvalidColorError extends Error {
  constructor(readonly value: string) {
    super("Contrast can only be computed for a 6-digit hex colour");
    this.name = "InvalidColorError";
  }
}

/**
 * Linearise one 8-bit channel. The 0.03928 threshold is WCAG 2.1's published
 * constant; the mathematically exact crossover is 0.04045, and the two differ
 * only in the fourth decimal place of a ratio, but the published value is used
 * so the numbers here match the ones in §4 and §8 exactly.
 */
function linearise(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.1 relative luminance. 0 for black, 1 for white. */
export function relativeLuminance(color: string): number {
  if (!isHexColor(color)) {
    throw new InvalidColorError(color);
  }
  const r = linearise(Number.parseInt(color.slice(1, 3), 16));
  const g = linearise(Number.parseInt(color.slice(3, 5), 16));
  const b = linearise(Number.parseInt(color.slice(5, 7), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio, 1:1 to 21:1. Order-independent. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Two decimal places — the precision §4 and §8 publish their ratios at. */
export function roundRatio(ratio: number): number {
  return Math.round(ratio * 100) / 100;
}

export interface ContrastCheck {
  readonly pair: ContrastPair;
  readonly foreground: string;
  readonly background: string;
  readonly ratio: number;
  readonly required: number;
  readonly passed: boolean;
  /** True when a failure must block the save rather than warn. */
  readonly blocking: boolean;
}

export interface ContrastReport {
  readonly checks: readonly ContrastCheck[];
  /** Failing text pairs. Non-empty means the save is refused (§9.2 rule 2). */
  readonly blockers: readonly ContrastCheck[];
  /** Failing non-text pairs. Reported, but the save proceeds. */
  readonly warnings: readonly ContrastCheck[];
  /** True when nothing blocks. Warnings do not affect it. */
  readonly passed: boolean;
}

/**
 * Run the gate over a complete token set.
 *
 * Takes a *complete* set rather than a partial skin on purpose: §7.4 orders
 * completeness (stage 4) before the contrast gate (stage 5), because a pair
 * involving a token the skin omitted must be checked against the value that
 * will actually render, not skipped.
 */
export function checkContrast(
  tokens: SemanticColorTokens,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): ContrastReport {
  const checks = pairs.map<ContrastCheck>((pair) => {
    const foreground = tokens[pair.fg];
    const background = tokens[pair.bg];
    const ratio = contrastRatio(foreground, background);
    const required = thresholdFor(pair.class);
    return {
      pair,
      foreground,
      background,
      ratio,
      required,
      // Rounded before comparison so a ratio reported as 4.50:1 is not refused
      // for missing the threshold in the fifteenth decimal place.
      passed: roundRatio(ratio) >= required,
      blocking: isBlocking(pair.class),
    };
  });

  const failures = checks.filter((check) => !check.passed);
  const blockers = failures.filter((check) => check.blocking);
  const warnings = failures.filter((check) => !check.blocking);

  return { checks, blockers, warnings, passed: blockers.length === 0 };
}

export { CONTRAST_PAIRS, EXEMPT_COLOR_TOKENS, CONTRAST_EXEMPTIONS } from "./contrast-pairs.js";
