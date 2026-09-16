/**
 * Tailwind v4 theme bridge (`design-system.md` §3.4, ADR-0007).
 *
 * ADR-0007's core claim is that a Tailwind-styled app repaints at runtime with
 * no rebuild: `bg-primary` must compile to `background-color: var(--primary)`,
 * never to a literal colour. Tailwind v4 resolves `@theme` blocks at build
 * time from CSS text, so the values inside them cannot be a JS function call
 * into this package — they have to be *text*, generated once and committed,
 * the same "derive, don't hand-maintain" approach `css.ts` takes for CSS
 * custom property names (`toCssCustomPropertyName`). This module is that
 * generator: it walks the same name-list exports `css.ts` emits from and
 * produces the `@theme` text that wires a Tailwind utility to the runtime
 * custom property of the same token, so the two can never drift apart.
 *
 * Three things make this more than a mechanical rename:
 *
 *  1. **`@theme inline` is load-bearing, not stylistic.** A plain `@theme
 *     { --color-primary: var(--primary); }` makes Tailwind resolve and cache
 *     the variable's value at the point the utility is *defined*; `inline`
 *     makes Tailwind copy the `var(--primary)` reference itself into every
 *     generated utility, so the utility keeps pointing at the runtime custom
 *     property instead of freezing whatever it resolved to at build time.
 *     Confirmed against tailwindcss@4.3.3: with `inline`, `.bg-primary`
 *     compiles to `background-color: var(--primary)`; without it, nothing
 *     in this package's build pipeline would fail, but the whole point of
 *     ADR-0007 would silently stop being true.
 *
 *  2. **This package's naming convention (§3.2) already matches Tailwind's
 *     namespace vocabulary for most categories.** `--radius-xs`, `--shadow-md`,
 *     `--text-2xs`, `--tracking-wide`, `--leading-snug`, `--font-weight-medium`
 *     are simultaneously valid `toCssCustomPropertyName` output *and* valid
 *     Tailwind theme keys, so most entries below are self-referential
 *     (`--radius-xs: var(--radius-xs);`) — that is correct, not a mistake:
 *     it is `@theme inline` telling Tailwind "this utility exists, point it at
 *     the property of the same name." Only two categories need an actual
 *     rename: colours (`--primary` → Tailwind's `--color-primary`) and
 *     spacing (`--space-4` → Tailwind's `--spacing-4`, because this package's
 *     `space` prefix predates the token catalogue and Tailwind's spacing
 *     namespace is `--spacing-*`).
 *
 *  3. **Not every token has a Tailwind utility to bridge to.** Verified
 *     against tailwindcss@4.3.3's actual theme namespaces (there is no
 *     substitute for running the compiler and reading its output): z-index
 *     and motion-duration have no theme namespace in v4 at all — `z-*` and
 *     `duration-*` utilities exist but are not theme-configurable, so
 *     declaring `--z-modal` inside `@theme` compiles to a harmless, useless
 *     `:root` re-declaration with no utility class ever generated for it.
 *     The same is true of every layer-3 component token (`--button-radius`,
 *     `--sidebar-width`, …) and this package's own scale/multiplier inputs
 *     (`--space-unit`, `--density-scale`, `--radius-root`, `--shadow-depth`,
 *     `--shadow-color`, `--motion-scale`, `--font-size-base`,
 *     `--font-scale-ratio`): none of them names a Tailwind namespace.
 *     `UNMAPPED_CATEGORIES` documents these explicitly, generated from the
 *     same exports, rather than the alternative — emitting a `@theme` entry
 *     that produces no class and inviting a reader to think it does
 *     something. These tokens are not orphaned: `serializeBaseStylesheet`
 *     already emits every one of them at `:root` (`css.ts`), so a component
 *     that needs `--button-radius` writes `border-radius: var(--button-radius)`
 *     directly — there was never a missing step, only a missing Tailwind
 *     *utility*, which is a different thing.
 *
 * `generateTailwindThemeCss` is a pure function of this package's token
 * tables — it takes no runtime input and calls no I/O, so it can be unit
 * tested and is safe to run inside `scripts/generate-tailwind-theme.mjs`,
 * whose only job is to add the "generated file" banner and write the result
 * to `apps/web/src/styles/tailwind-theme.generated.css`.
 * `scripts/gates/tailwind-theme-drift.mjs` re-runs this function and fails the
 * commit if the checked-in file no longer matches — the same defence-in-depth
 * pattern as `scripts/gates/prisma-sqlalchemy-drift.mjs` for the other
 * generated file in this repository.
 */

import { COMPONENT_TOKEN_NAMES } from "./components.js";
import { toCssCustomPropertyName } from "./css.js";
import {
  breakpoints,
  motion,
  radius,
  SEMANTIC_COLOR_TOKEN_NAMES,
  shadow,
  spacing,
  typography,
  zIndex,
} from "./semantic.js";

/** One `@theme` declaration: the Tailwind-facing key and the value it takes. */
interface ThemeEntry {
  readonly tailwindProperty: string;
  readonly value: string;
}

/** `--<kebab>` for a token key, without the leading `--` (`css.ts`'s convention, unprefixed). */
function sourceVar(key: string): string {
  return toCssCustomPropertyName(key);
}

/** The common case: Tailwind's key for this token is the same as its own custom property. */
function selfReferential(key: string): ThemeEntry {
  const name = sourceVar(key);
  return { tailwindProperty: name, value: `var(${name})` };
}

/**
 * Layer-2 colours (§4.1–§4.5). Tailwind has no bare `--primary`-style colour
 * namespace — colour utilities read `--color-*` — so this is the one category
 * where the Tailwind key is a genuine rename of the source property, not a
 * repetition of it.
 */
function colorEntries(): ThemeEntry[] {
  return SEMANTIC_COLOR_TOKEN_NAMES.map((name) => {
    const source = sourceVar(name); // e.g. "--primary-foreground"
    const suffix = source.slice(2); // strip the leading "--": "primary-foreground"
    return { tailwindProperty: `--color-${suffix}`, value: `var(${source})` };
  });
}

/**
 * Typography (§4.6). `fontSans`/`fontMono`/`fontArabic` are named explicitly
 * rather than matched by a `font` prefix, because `fontWeight*` also starts
 * with `font` and belongs to a different Tailwind namespace (`--font-weight-*`).
 *
 * Font size and line height are deliberately *not* paired the way Tailwind's
 * own default scale pairs them (`--text-sm--line-height`): §4.6 treats leading
 * as an axis a component chooses independently of size (`leadingArabic` on a
 * `textBase` line, `leadingTight` on a `text2xl` heading), and Tailwind's
 * paired form would invent a fixed size↔leading relationship this design
 * system does not have. `--leading-*` is emitted as its own namespace instead.
 */
const FONT_FAMILY_KEYS = ["fontSans", "fontMono", "fontArabic"] as const;

function typographyEntries(): { mapped: ThemeEntry[]; unmapped: string[] } {
  const mapped: ThemeEntry[] = [];
  const unmapped: string[] = [];

  for (const key of Object.keys(typography)) {
    if ((FONT_FAMILY_KEYS as readonly string[]).includes(key)) {
      mapped.push(selfReferential(key));
    } else if (
      key.startsWith("text") ||
      key.startsWith("leading") ||
      key.startsWith("fontWeight") ||
      key.startsWith("tracking")
    ) {
      mapped.push(selfReferential(key));
    } else {
      // `fontSizeBase`, `fontScaleRatio` — inputs the type scale's own
      // `calc()` chain was derived from (§4.6), not a utility-facing size.
      unmapped.push(key);
    }
  }

  return { mapped, unmapped };
}

/**
 * Spacing (§4.7). Tailwind's namespace is `--spacing-*`; this package's is
 * `--space-*`, a mismatch that predates the token catalogue, so every numeric
 * step is a real rename, keyed by the trailing number only (`space4` →
 * `--spacing-4`). `spacePx` follows Tailwind's own convention for the
 * hairline step. The five component-shaped entries (`controlHeightSm` etc.)
 * are not part of the numeric scale and are left unmapped.
 */
const SPACING_STEP_PATTERN = /^space(\d+)$/;
const SPACING_COMPONENT_KEYS = [
  "controlHeightSm",
  "controlHeightMd",
  "controlHeightLg",
  "rowHeight",
  "pageGutter",
] as const;

function spacingEntries(): { mapped: ThemeEntry[]; unmapped: string[] } {
  const mapped: ThemeEntry[] = [];
  const unmapped: string[] = [];

  for (const key of Object.keys(spacing)) {
    const step = SPACING_STEP_PATTERN.exec(key);
    if (step) {
      mapped.push({ tailwindProperty: `--spacing-${step[1]}`, value: `var(${sourceVar(key)})` });
    } else if (key === "spacePx") {
      mapped.push({ tailwindProperty: "--spacing-px", value: `var(${sourceVar(key)})` });
    } else if ((SPACING_COMPONENT_KEYS as readonly string[]).includes(key)) {
      unmapped.push(key);
    } else {
      // `spaceUnit`, `densityScale` — the multiplier every step above is
      // already computed from; not a step of the scale themselves.
      unmapped.push(key);
    }
  }

  return { mapped, unmapped };
}

/**
 * Radius (§4.8). `radiusRoot` is the Phase E corner-radius control, not a
 * scale step — it would collide with `--radius-*` and produce a meaningless
 * `rounded-root` utility, so it is excluded and left for direct `var()` use.
 */
function radiusEntries(): { mapped: ThemeEntry[]; unmapped: string[] } {
  const mapped: ThemeEntry[] = [];
  const unmapped: string[] = [];

  for (const key of Object.keys(radius)) {
    if (key === "radiusRoot") unmapped.push(key);
    else mapped.push(selfReferential(key));
  }

  return { mapped, unmapped };
}

/**
 * Shadow (§4.8). `shadowDepth` and `shadowColor` are the multiplier and base
 * colour every stop's `calc()` reads from, not stops themselves.
 */
function shadowEntries(): { mapped: ThemeEntry[]; unmapped: string[] } {
  const mapped: ThemeEntry[] = [];
  const unmapped: string[] = [];

  for (const key of Object.keys(shadow)) {
    if (key === "shadowDepth" || key === "shadowColor") unmapped.push(key);
    else mapped.push(selfReferential(key));
  }

  return { mapped, unmapped };
}

/**
 * Motion (§4.8). `--ease-*` is a real Tailwind v4 namespace and every easing
 * curve maps to it directly. Verified against tailwindcss@4.3.3: there is no
 * `--duration-*` (or any transition-duration) theme namespace, so durations
 * and `motionScale` are left unmapped — `duration-*` utilities exist in
 * Tailwind but are a fixed, non-theme-configurable scale.
 */
function motionEntries(): { mapped: ThemeEntry[]; unmapped: string[] } {
  const mapped: ThemeEntry[] = [];
  const unmapped: string[] = [];

  for (const key of Object.keys(motion)) {
    if (key.startsWith("ease")) mapped.push(selfReferential(key));
    else unmapped.push(key);
  }

  return { mapped, unmapped };
}

/**
 * Breakpoints (§4.9) — the one category that is a literal, not a `var()`.
 * `css.ts` never emits these as custom properties (they cannot appear in a
 * media-query condition), so there is no runtime property to point at:
 * Tailwind's `--breakpoint-*` values must be the pixel literal itself. This
 * is the deliberate exception to "every value below is `var()`".
 */
const BREAKPOINT_KEY_PATTERN = /^bp([A-Z][a-z]*)$/;

function breakpointEntries(): ThemeEntry[] {
  return Object.entries(breakpoints).map(([key, value]) => {
    const match = BREAKPOINT_KEY_PATTERN.exec(key);
    if (!match || !match[1]) {
      throw new Error(`Breakpoint key "${key}" does not match the expected "bp<Name>" shape`);
    }
    return { tailwindProperty: `--breakpoint-${match[1].toLowerCase()}`, value };
  });
}

/** The five per-category passes, computed once and shared by the bridge and the doc comment. */
interface CategoryResults {
  readonly typography: { mapped: ThemeEntry[]; unmapped: string[] };
  readonly spacing: { mapped: ThemeEntry[]; unmapped: string[] };
  readonly radius: { mapped: ThemeEntry[]; unmapped: string[] };
  readonly shadow: { mapped: ThemeEntry[]; unmapped: string[] };
  readonly motion: { mapped: ThemeEntry[]; unmapped: string[] };
}

function computeCategoryResults(): CategoryResults {
  return {
    typography: typographyEntries(),
    spacing: spacingEntries(),
    radius: radiusEntries(),
    shadow: shadowEntries(),
    motion: motionEntries(),
  };
}

/**
 * Every unmapped token, grouped for the documentation comment at the foot of
 * the generated file. Layer-3 component tokens (§4.10) are entirely unmapped:
 * none names a Tailwind namespace, because each is a bespoke knob for the one
 * component that owns it (`--button-radius`, `--sidebar-width`, …) rather than
 * a general-purpose utility scale.
 */
function unmappedCategories(
  results: CategoryResults,
): ReadonlyArray<{ readonly category: string; readonly keys: readonly string[] }> {
  return [
    { category: "typography (scale inputs)", keys: results.typography.unmapped },
    { category: "spacing (scale input + component-shaped)", keys: results.spacing.unmapped },
    { category: "radius (root control)", keys: results.radius.unmapped },
    { category: "shadow (depth control + colour input)", keys: results.shadow.unmapped },
    { category: "z-index (no v4 theme namespace)", keys: Object.keys(zIndex) },
    { category: "motion (no v4 duration theme namespace)", keys: results.motion.unmapped },
    {
      category: "component — layer 3 (§4.10, no matching utility namespace)",
      keys: [...COMPONENT_TOKEN_NAMES],
    },
  ];
}

/** Render one `@theme` (or `@theme inline`) block from a list of entries. */
function renderBlock(header: string, entries: readonly ThemeEntry[]): string {
  const lines = entries.map((e) => `  ${e.tailwindProperty}: ${e.value};`);
  return `${header} {\n${lines.join("\n")}\n}`;
}

/**
 * The full generated CSS body: the reset that clears Tailwind's built-in
 * default theme, the `@theme inline` bridge for every token category that
 * has a real Tailwind utility namespace, the breakpoint literals, and a
 * documentation comment enumerating what was deliberately left unmapped
 * and why. Does not include the "generated file" banner — that is the
 * generation script's job (`scripts/generate-tailwind-theme.mjs`), matching
 * `serializeBaseStylesheet` returning pure CSS with no file-level concerns.
 *
 * ADR-0007's Tailwind config note says "replaces (not extends)": if this
 * package's tokens are the *only* colours, spacing, radius, shadow, easing,
 * font and breakpoint values available, `bg-red-500` or `p-7` must not
 * compile at all. Tailwind v4 has no config-level equivalent of v3's
 * `theme:` (replace) vs `theme.extend:` (merge) — every `@theme` block
 * merges with the built-in default theme by default — so the reset below
 * uses the wildcard-`initial` form (`--color-*: initial;`) to clear each
 * namespace before this module repopulates it. Verified against
 * tailwindcss@4.3.3: without the reset, `bg-red-500` and `p-7` remain valid,
 * literal-value utilities; with it, only the classes generated below exist.
 */
export function generateTailwindThemeCss(): string {
  const results = computeCategoryResults();

  const resetBlock = renderBlock(
    "@theme",
    [
      "--color-*",
      "--font-*",
      "--text-*",
      "--font-weight-*",
      "--tracking-*",
      "--leading-*",
      "--breakpoint-*",
      "--container-*",
      "--spacing",
      "--radius-*",
      "--shadow-*",
      "--inset-shadow-*",
      "--drop-shadow-*",
      "--ease-*",
      "--animate-*",
      "--blur-*",
      "--perspective-*",
      "--aspect-*",
    ].map((tailwindProperty) => ({ tailwindProperty, value: "initial" })),
  );

  const bridgeBlock = renderBlock("@theme inline", [
    ...colorEntries(),
    ...results.typography.mapped,
    ...results.spacing.mapped,
    ...results.radius.mapped,
    ...results.shadow.mapped,
    ...results.motion.mapped,
  ]);

  const breakpointBlock = renderBlock("@theme", breakpointEntries());

  const unmappedComment = [
    "/*",
    " * Tokens with no Tailwind v4 utility namespace to bridge to (verified against",
    " * tailwindcss@4.3.3 — see the module docstring in tailwind-theme.ts). These",
    " * remain ordinary runtime custom properties, already emitted at `:root` by",
    " * `serializeBaseStylesheet` (css.ts) — a component consumes them directly,",
    " * e.g. `border-radius: var(--button-radius)`, never through a Tailwind class.",
    " *",
    ...unmappedCategories(results).flatMap(({ category, keys }) =>
      keys.length > 0
        ? [` * ${category}:`, ` *   ${keys.map((k) => toCssCustomPropertyName(k)).join(", ")}`]
        : [],
    ),
    " */",
  ].join("\n");

  return [
    "/* Reset: clear Tailwind's built-in default theme (ADR-0007 — replace, not extend). */",
    resetBlock,
    "",
    "/* Bridge: every token category with a real Tailwind utility namespace, each",
    "   pointing at this package's runtime custom property rather than a value",
    "   (design-system.md §3.4). */",
    bridgeBlock,
    "",
    "/* Breakpoints (§4.9): build-time literals, the one deliberate non-var() exception. */",
    breakpointBlock,
    "",
    unmappedComment,
    "",
  ].join("\n");
}
