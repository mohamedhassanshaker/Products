#!/usr/bin/env node
/**
 * Gate: no hardcoded design values, and no physical direction properties.
 *
 * ADR-0007. Phase E requires that changing a token repaints the whole app with
 * no rebuild and no per-component overrides. That only holds if feature code
 * consumes tokens and never literals — one `bg-[#1F6F5C]` is a pixel that a
 * tenant's branding cannot reach, and per-tenant white-labelling is a hard
 * requirement for a multi-entity government system.
 *
 * The direction half exists because RTL is a first-class requirement (Arabic is
 * a measured quality gate, B13) and retrofitting logical properties across 17
 * screens is exactly the work this gate prevents.
 *
 * ADR-0007 is explicit that this must land in the first commit: retrofitting it
 * after feature code exists means fixing hundreds of violations.
 *
 * Covers §12.1 in full (hex/rgb/hsl/hsla/oklch colour literals, px/pt/em
 * length literals, hardcoded `font-family:` declarations) and §12.2 in full
 * (physical direction properties/utilities, numeric z-index, and an outline
 * removed with no replacement ring). Kept in one file because every check
 * here is the same shape — scan a line, match a pattern, report — with one
 * exception: the outline/ring check tests for a pattern's *absence* nearby
 * rather than its presence, so it runs as its own pass instead of a RULES
 * entry (see `findOutlineWithoutRing` below).
 *
 * Escape hatch: append `design-gate-allow: <reason>` in a comment on the same
 * line. Allowances are counted and printed, so they stay visible instead of
 * accumulating silently. A gate people disable is worse than one with a
 * documented, greppable exception.
 */

import { resolve, relative } from "node:path";
import { collectFiles, read, toPosix, report, matchLines } from "./lib/walk.mjs";

const ROOT = resolve(import.meta.dirname, "../..");

/**
 * Layer-1 primitives and the theme plumbing are where real values belong.
 * Everything else consumes layer-2 semantic and layer-3 component tokens.
 */
const ALLOWED_PREFIXES = [
  "packages/tokens/",
  "packages/ui/src/theme/",
  "apps/web/src/app/globals.css",
  "apps/web/tailwind.config.ts",
  // Machine-generated Tailwind v4 theme bridge (ADR-0007, design-system.md
  // §3.4) — a `@theme` block of `--x: var(--y);` pairs derived from
  // packages/tokens/src/tailwind-theme.ts, never hand-written. It lives
  // outside packages/tokens/ (it is build output for apps/web, not the token
  // package itself), so it needs its own allowance; scripts/gates/tailwind-
  // theme-drift.mjs is what actually keeps it honest against the generator.
  "apps/web/src/styles/tailwind-theme.generated.css",
  // §12.1's one named exception: the screen that lets a user type or paste a
  // raw colour into a token slot while building a skin. Every value it writes
  // is re-validated by packages/tokens (assertSafeCssValue) before it can
  // reach a stylesheet, so the raw literal is contained to this one editor
  // surface rather than leaking into feature code. Added ahead of the
  // directory existing (no component wave has run yet) so a future wave never
  // has to touch this gate just to build the screen the spec already names.
  "apps/web/src/components/patterns/skin-editor/",
];

const RULES = [
  {
    id: "tailwind-arbitrary-value",
    // bg-[#fff], p-[13px], rounded-[7px], text-[14px], w-[calc(...)]
    //
    // Excludes Tailwind's *arbitrary variant* syntax — data-[state=open]:x,
    // group-data-[size=sm]/switch:x, aria-[current=page]:x — via the trailing
    // negative lookahead. An arbitrary variant's bracket is a CSS
    // attribute-selector condition, not a design value at all: nothing inside
    // it is a colour, length or font, so it was never what this rule is for.
    // The distinguishing signal is mechanical and reliable: a real arbitrary
    // *value* bracket is never immediately followed by (an optional
    // /group-name then) a `:`, because that position is where Tailwind's own
    // variant separator lives — only a variant bracket is followed by one.
    // Found empirically (not assumed) when adapting the shadcn Radix
    // components: the unqualified rule flagged `data-[state=checked]:bg-primary`
    // as if `state=checked` were a hardcoded colour, forcing Checkbox/
    // RadioGroup/Switch into hand-rolled JS state-mirroring purely to dodge a
    // false positive — real, avoidable complexity every future Radix-based
    // molecule/organism (Tabs, Dialog, DropdownMenu, Popover, Slider, …) would
    // have kept re-paying. Verified against both directions before landing:
    // every arbitrary-variant shape above now passes, while every real
    // violation already caught in the unadapted scaffold files (ring-[3px],
    // translate-x-[calc(100%-2px)], rounded-[2px], z-[999], …) still fails.
    pattern: /(?:^|["'\s:`])[a-z][a-z0-9]*(?:-[a-z0-9]+)*-\[[^\]]+\](?!\/?[\w-]*:)/,
    note: "Tailwind arbitrary value — use a token-backed utility instead",
    extensions: [".ts", ".tsx", ".css"],
  },
  {
    id: "raw-hex-colour",
    pattern: /#[0-9a-fA-F]{3,8}\b/,
    note: "Raw hex colour — define it as a token in packages/tokens and consume the token",
    extensions: [".ts", ".tsx", ".css"],
  },
  {
    id: "raw-colour-function",
    // rgb(), rgba(), hsl(), hsla(), oklch() literals — §12.1's exact pattern.
    // Hex is the common case and gets its own rule above; this is the rest of
    // CSS's colour syntax, which a hex-only check would miss entirely.
    pattern: /\b(?:rgb|rgba|hsl|hsla|oklch)\(/,
    note: "Raw colour function literal — define it as a token in packages/tokens and consume the token",
    extensions: [".ts", ".tsx", ".css"],
  },
  {
    id: "raw-length-literal",
    // A bare px/pt/em length — §12.1's exact pattern. Catches both a literal
    // outside any Tailwind class (a `style={{ padding: "13px" }}` object, an
    // SVG attribute, a canvas draw call) and one hiding inside a Tailwind
    // arbitrary-value bracket, which `tailwind-arbitrary-value` above already
    // flags on its own — the two rules overlapping on the same line is
    // intentional double coverage, not a bug (see `raw-hex-colour` doing the
    // same for `bg-[#1F6F5C]`).
    pattern: /\b\d+(?:px|pt|em)\b/,
    note: "Raw length literal — define it as a spacing/radius/typography token in packages/tokens",
    extensions: [".ts", ".tsx", ".css"],
  },
  {
    id: "hardcoded-font-family",
    pattern: /font-family\s*:/,
    note: "Hardcoded font-family — reference a token font stack (packages/tokens/src/semantic.ts) instead",
    extensions: [".ts", ".tsx", ".css"],
  },
  {
    id: "physical-direction-property",
    pattern:
      /\b(?:padding|margin|border|inset)-(?:left|right)\b|\b(?:left|right)\s*:\s*(?!auto\b)|\btext-align\s*:\s*(?:left|right)\b/,
    note: "Physical direction property — use the logical equivalent (padding-inline-start, inset-inline-start, text-align: start)",
    extensions: [".css", ".ts", ".tsx"],
  },
  {
    id: "physical-direction-utility",
    // Tailwind physical utilities: pl-4 pr-4 ml-2 mr-2 text-left text-right border-l border-r
    pattern:
      /(?:^|["'\s`])(?:p[lr]|m[lr]|border-[lr]|rounded-[lr]|(?:top|bottom)-0\.5)-[0-9a-z]|(?:^|["'\s`])text-(?:left|right)(?:$|["'\s`])/,
    note: "Physical direction utility — use the logical form (ps-/pe-, ms-/me-, border-s/border-e, text-start/text-end)",
    extensions: [".ts", ".tsx"],
  },
  {
    id: "numeric-z-index-utility",
    // z-50, z-10, z-[999] … Tailwind's own built-in numeric scale. The named
    // scale this project ships (z-dropdown, z-modal, z-toast, …) is
    // token-backed and stays allowed — only a bare number is banned, because
    // only a bare number can never repaint from a skin (§4.8, §12.2).
    pattern: /(?:^|["'\s`])z-\d+\b/,
    note: "Numeric z-index utility — use the named scale (z-dropdown, z-modal, …) from packages/tokens (§4.8)",
    extensions: [".ts", ".tsx"],
  },
  {
    id: "numeric-z-index-property",
    pattern: /\bz-index\s*:\s*-?\d+\b/,
    note: "Numeric z-index — use var(--z-*) from the named scale in packages/tokens (§4.8)",
    extensions: [".css"],
  },
];

function isAllowed(rel) {
  return ALLOWED_PREFIXES.some((p) => rel === p || rel.startsWith(p));
}

/**
 * §10.3 / §12.2: focus is never removed without a replacement ring. This is a
 * paired-absence check — pattern A present *and* pattern B missing nearby —
 * which the RULES array above cannot express, since every entry there is "one
 * pattern, if matched, always a finding." So it gets its own pass rather than
 * a RULES entry, per the file header note.
 *
 * "Nearby" is a small line window rather than the same line only, because the
 * CSS form can split the removal and the replacement across declarations
 * (`outline: none;` / `outline: var(--focus-ring-width) solid var(--ring);`
 * are never both true at once, but a real stylesheet pairs `outline: none`
 * with a *different* replacement declaration such as a box-shadow ring a line
 * or two below it). The Tailwind form — `outline-none` alongside `ring-*` in
 * one class string — always satisfies a window of zero, so widening the
 * window costs nothing there and is what makes the CSS form checkable at all
 * without a real parser (walk.mjs's stated design boundary for every gate
 * here).
 */
function findOutlineWithoutRing(files) {
  const OUTLINE_REMOVED = /\boutline-none\b|\boutline\s*:\s*none\b/;
  // Matches a Tailwind `ring-*` utility (ring-2, ring-[3px], ring-ring/50,
  // ring-offset-2, focus-visible:ring-…) and a bare `--ring` custom-property
  // reference (an `outline` re-set through the token) in one pattern: every
  // one of those forms contains "ring" bounded by non-word characters.
  const RING_SIGNAL = /\bring\b/;
  const WINDOW = 2;

  const findings = [];
  let allowed = 0;

  for (const file of files) {
    const rel = toPosix(relative(ROOT, file));
    if (isAllowed(rel)) continue;
    if (rel.includes(".test.") || rel.includes(".spec.")) continue;
    if (!/\.(ts|tsx|css)$/.test(rel)) continue;

    const lines = read(file).split("\n");

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!OUTLINE_REMOVED.test(line)) continue;
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) continue;

      if (/design-gate-allow:\s*\S/.test(line)) {
        allowed++;
        continue;
      }

      const from = Math.max(0, i - WINDOW);
      const to = Math.min(lines.length, i + WINDOW + 1);
      // Comment lines are prose, not a replacement — a nearby comment that
      // merely mentions "ring" must not mask a real violation, so they are
      // excluded before the signal is searched for.
      const context = lines
        .slice(from, to)
        .filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
        .join("\n");
      if (RING_SIGNAL.test(context)) continue;

      findings.push({
        file: rel,
        line: i + 1,
        excerpt: line,
        note: "outline-none-without-ring: focus outline removed with no replacement ring within 2 lines — §10.3",
      });
    }
  }

  return { findings, allowed };
}

const files = [
  ...collectFiles(resolve(ROOT, "apps/web"), [".ts", ".tsx", ".css"]),
  ...collectFiles(resolve(ROOT, "packages"), [".ts", ".tsx", ".css"]),
];

const findings = [];
let allowed = 0;

for (const file of files) {
  const rel = toPosix(relative(ROOT, file));
  if (isAllowed(rel)) continue;
  if (rel.includes(".test.") || rel.includes(".spec.")) continue;

  const source = read(file);

  for (const rule of RULES) {
    if (!rule.extensions.some((e) => rel.endsWith(e))) continue;

    for (const hit of matchLines(source, rule.pattern)) {
      // Comment lines describe rules rather than break them.
      if (/^\s*(\/\/|\/\*|\*)/.test(hit.excerpt)) continue;

      if (/design-gate-allow:\s*\S/.test(hit.excerpt)) {
        allowed++;
        continue;
      }

      findings.push({
        file: rel,
        line: hit.line,
        excerpt: hit.excerpt,
        note: `${rule.id}: ${rule.note}`,
      });
    }
  }
}

const outlineRing = findOutlineWithoutRing(files);
findings.push(...outlineRing.findings);
allowed += outlineRing.allowed;

if (allowed > 0) {
  console.log(`  note ${allowed} documented design-gate-allow exception(s) in feature code`);
}

const code = report({
  gate: "no-hardcoded-design-values",
  rule: "Feature code consumes semantic and component tokens only; logical direction properties only (ADR-0007)",
  findings,
  hint:
    "Define the value as a token in packages/tokens and consume it, or use the logical\n" +
    "  direction utility. If a literal is genuinely unavoidable, append a same-line comment\n" +
    "  `design-gate-allow: <reason>` so the exception is visible rather than silent.",
});

process.exit(code);
