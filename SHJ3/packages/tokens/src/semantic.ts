/**
 * Layer 2 — semantic role tokens (`design-system.md` §3.1, §4; ADR-0007).
 *
 * This is the layer a skin overrides, and therefore the layer whose *names* are
 * a public contract: feature code says `bg-primary`, never `bg-green-600`, so a
 * tenant can re-point the role without touching a component (§2 P2).
 *
 * Structure follows §4's categories. Only the 66 colour tokens vary by mode —
 * typography, spacing, radius, shadow, z-index and motion are mode-independent,
 * which is why `semanticColors` is keyed by mode and the rest are flat.
 *
 * Values are taken from §4's Light/Dark columns, which the document states are
 * the Sharjah Default and Sharjah Dark skins respectively (§4 preamble). The
 * two shipped skins in `skins/` therefore reference these records rather than
 * restating the values — a second copy is a second thing to drift, and §12.4's
 * contrast suite asserts the documented ratios against whatever is here.
 *
 * Where §3.3 lifts a value into layer 1, it is referenced from there so the
 * derivation is visible in code. Where it does not — the warning and info
 * families, chart 6, and most dark-mode values — the literal sits here, which
 * is where §4 publishes it.
 */

import { primitives as p } from "./primitives.js";

/** Resolved appearance mode. `system` is resolved to one of these server-side (§9.4). */
export type ColorMode = "light" | "dark";

/**
 * The 66 colour roles, in §4's order: surfaces (15), brand (7), status (16),
 * assistant surface (9), sidebar/chart/utility (19).
 *
 * The array is the source of truth for "which names may a skin set" and for
 * §12.4's coverage assertion, so it is declared once and the record type is
 * derived from it rather than the other way round.
 */
export const SEMANTIC_COLOR_TOKEN_NAMES = [
  // §4.1 — surfaces, text and structure.
  "background",
  "foreground",
  "surfaceSunken",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "muted",
  "mutedForeground",
  "border",
  "borderStrong",
  "input",
  "ring",
  "ringOffset",
  "overlay",

  // §4.2 — brand.
  "primary",
  "primaryForeground",
  "primaryHover",
  "secondary",
  "secondaryForeground",
  "accent",
  "accentForeground",

  // §4.3 — semantic status, four roles x four slots.
  "success",
  "successForeground",
  "successSubtle",
  "successStrong",
  "warning",
  "warningForeground",
  "warningSubtle",
  "warningStrong",
  "destructive",
  "destructiveForeground",
  "destructiveSubtle",
  "destructiveStrong",
  "info",
  "infoForeground",
  "infoSubtle",
  "infoStrong",

  // §4.4 — assistant surface.
  "chatUserBubble",
  "chatUserBubbleForeground",
  "chatAssistantBubble",
  "chatAssistantBubbleForeground",
  "chatMetaForeground",
  "chatDisclaimer",
  "chatDisclaimerForeground",
  "chatComposer",
  "chatTyping",

  // §4.5 — sidebar, chart and utility.
  "sidebar",
  "sidebarForeground",
  "sidebarMutedForeground",
  "sidebarAccent",
  "sidebarActiveSurface",
  "sidebarBorder",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "chart6",
  "selection",
  "selectionForeground",
  "skeleton",
  "codeSurface",
  "codeForeground",
  "disabledSurface",
  "disabledForeground",
] as const;

export type SemanticColorTokenName = (typeof SEMANTIC_COLOR_TOKEN_NAMES)[number];

/**
 * A complete colour token set. Every role is present: a partially populated set
 * is a half-applied theme, which §2 P7 forbids, so incompleteness is expressed
 * as `Partial<SemanticColorTokens>` at the one place it is legitimate — an
 * imported skin before §7.4 stage 4 fills it.
 */
export type SemanticColorTokens = { readonly [K in SemanticColorTokenName]: string };

/**
 * `overlay` is the one colour role that is not a 6-digit hex: a modal scrim
 * needs alpha, so §7.2 gives it a separate, equally narrow pattern.
 */
export const ALPHA_COLOR_TOKEN_NAMES: readonly SemanticColorTokenName[] = ["overlay"];

const light: SemanticColorTokens = {
  background: p.paper,
  foreground: p.ink900,
  surfaceSunken: p.sand100,
  card: p.panel,
  cardForeground: p.ink900,
  popover: p.panel,
  popoverForeground: p.ink900,
  muted: p.sand100,
  mutedForeground: p.ink500,
  border: p.sand200,
  borderStrong: p.sand400,
  input: p.panel,
  ring: p.green600,
  // Tracks `background` so the focus ring's halo reads on card, muted and
  // sidebar alike (§10.3).
  ringOffset: p.paper,
  overlay: "rgb(32 36 43 / 0.44)",

  primary: p.green600,
  primaryForeground: p.panel,
  primaryHover: "#1A5D4D",
  // Hue-neutral by design: a second-rank button must stay neutral when a tenant
  // re-brands, which is why `secondary` and `accent` are separate roles (§4.2).
  secondary: p.sand100,
  secondaryForeground: p.ink900,
  accent: p.green100,
  accentForeground: p.green800,

  // Independent of `primary` even though both are the wireframe green here:
  // §4.3's decoupling is what stops a re-brand changing what `Healthy` means.
  success: p.green600,
  successForeground: p.panel,
  successSubtle: p.green100,
  successStrong: p.green800,
  // Amber is a hue the wireframe does not have. §4.3 introduces it because the
  // backoffice needs three status bands, not two.
  warning: "#8A5A12",
  warningForeground: p.panel,
  warningSubtle: "#F7EBD4",
  warningStrong: "#6E4709",
  destructive: p.rust600,
  destructiveForeground: p.panel,
  destructiveSubtle: p.rust100,
  destructiveStrong: p.rust700,
  info: "#2A5D9F",
  infoForeground: p.panel,
  infoSubtle: "#DFE9F6",
  infoStrong: "#1F4C86",

  // Tinted from `primary` and `muted`, but stored independently: B10 tab 2's
  // widget studio writes `chatUserBubble` directly from an entity's accent
  // colour (§4.4).
  chatUserBubble: "#D7EFE7",
  chatUserBubbleForeground: p.ink900,
  chatAssistantBubble: "#F1EDE4",
  chatAssistantBubbleForeground: p.ink900,
  chatMetaForeground: p.ink500,
  chatDisclaimer: p.sand100,
  chatDisclaimerForeground: p.ink500,
  chatComposer: p.panel,
  chatTyping: p.ink500,

  sidebar: p.sand100,
  sidebarForeground: p.ink900,
  sidebarMutedForeground: p.ink500,
  sidebarAccent: p.green600,
  sidebarActiveSurface: p.green100,
  sidebarBorder: p.sand200,
  // Ordered by hue separation, not brand priority, and every series clears
  // 4.5:1 on `card` so a value label can sit on the mark (§4.5).
  chart1: p.green600,
  chart2: "#2A5D9F",
  chart3: "#8A5A12",
  chart4: p.rust600,
  chart5: p.ink500,
  chart6: "#6E4B8F",
  selection: p.green100,
  selectionForeground: p.ink900,
  skeleton: p.sand100,
  codeSurface: p.sand100,
  codeForeground: p.ink900,
  disabledSurface: p.sand100,
  // Below 4.5:1 deliberately — WCAG 1.4.3 exempts disabled controls, and a
  // disabled control that looks enabled is the worse failure (§4.5). The
  // contrast gate skips this pair by name rather than silently.
  disabledForeground: "#8A8F99",
} as const;

const dark: SemanticColorTokens = {
  background: p.slate950,
  foreground: p.slate050,
  surfaceSunken: "#101317",
  card: p.slate900,
  cardForeground: p.slate050,
  popover: "#20252D",
  popoverForeground: p.slate050,
  muted: p.slate800,
  mutedForeground: p.slate200,
  border: "#2E343E",
  borderStrong: p.slate600,
  input: p.slate900,
  ring: "#5FC7AA",
  ringOffset: p.slate950,
  overlay: "rgb(10 12 15 / 0.62)",

  primary: "#4FB79B",
  primaryForeground: p.slate950,
  primaryHover: "#63C6AB",
  secondary: p.slate800,
  secondaryForeground: p.slate050,
  accent: "#12332B",
  accentForeground: p.green300,

  success: "#4FB79B",
  successForeground: p.slate950,
  successSubtle: "#12332B",
  successStrong: p.green300,
  warning: "#E0A33E",
  warningForeground: p.slate950,
  warningSubtle: "#38290F",
  // Equal to `warning` on purpose: on a dark ground the fill hue is already
  // light enough to serve as text, so §6.3's fill/text split collapses. The
  // tokens stay distinct so component code is mode-agnostic (§8.2).
  warningStrong: "#E0A33E",
  destructive: "#E08A70",
  destructiveForeground: p.slate950,
  destructiveSubtle: "#3A211A",
  destructiveStrong: "#F0B49F",
  info: "#76A9E8",
  infoForeground: p.slate950,
  infoSubtle: "#16283D",
  infoStrong: "#76A9E8",

  chatUserBubble: "#1E3A33",
  chatUserBubbleForeground: p.slate050,
  chatAssistantBubble: "#262B33",
  chatAssistantBubbleForeground: p.slate050,
  chatMetaForeground: p.slate200,
  chatDisclaimer: p.slate800,
  chatDisclaimerForeground: p.slate200,
  chatComposer: "#20252D",
  chatTyping: p.slate200,

  sidebar: "#141A18",
  sidebarForeground: p.slate050,
  sidebarMutedForeground: p.slate200,
  sidebarAccent: "#6FCDB0",
  sidebarActiveSurface: "#1E2B27",
  sidebarBorder: "#232B28",
  chart1: "#4FB79B",
  chart2: "#76A9E8",
  chart3: "#E0A33E",
  chart4: "#E08A70",
  chart5: p.slate200,
  chart6: "#B48FD6",
  selection: "#12332B",
  selectionForeground: p.slate050,
  skeleton: p.slate800,
  codeSurface: "#101317",
  codeForeground: p.slate050,
  disabledSurface: p.slate900,
  disabledForeground: "#6E7684",
} as const;

export const semanticColors: Readonly<Record<ColorMode, SemanticColorTokens>> = {
  light,
  dark,
} as const;

// ---------------------------------------------------------------------------
// §4.6 Typography (26)
// ---------------------------------------------------------------------------

/**
 * Allowlisted font stack ids (§7.2 `$defs/fontStackRef`).
 *
 * A skin references an id, never a raw `font-family` string. A free string is
 * both a CSS-injection vector and a way to reference an unlicensed or
 * unavailable face, so the stack — including its fallbacks — is resolved here.
 */
export const FONT_STACK_IDS = [
  "ibm-plex-sans",
  "ibm-plex-mono",
  "ibm-plex-sans-arabic",
  "noto-sans",
  "noto-sans-arabic",
  "system-ui",
  "dubai",
] as const;

export type FontStackRef = (typeof FONT_STACK_IDS)[number];

/**
 * Resolution of each allowlisted id to a full family list.
 *
 * §4.6 publishes the three IBM Plex stacks verbatim. The remaining four ids are
 * in §7.2's enum but have no published family list; their fallback chains are
 * composed here on the same principle §4.6 states — a Windows-resident face
 * last, because that is what ships on the Sharjah government desktops.
 * **[ASSUMPTION]**
 */
export const fontStacks: Readonly<Record<FontStackRef, string>> = {
  "ibm-plex-sans":
    '"IBM Plex Sans", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif',
  "ibm-plex-mono":
    '"IBM Plex Mono", "Cascadia Mono", ui-monospace, "SFMono-Regular", Consolas, "Liberation Mono", monospace',
  "ibm-plex-sans-arabic":
    '"IBM Plex Sans Arabic", "Noto Sans Arabic", "Dubai", "Geeza Pro", Tahoma, sans-serif',
  "noto-sans": '"Noto Sans", "Segoe UI", system-ui, -apple-system, Arial, sans-serif',
  "noto-sans-arabic": '"Noto Sans Arabic", "IBM Plex Sans Arabic", "Dubai", Tahoma, sans-serif',
  "system-ui": 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  dubai: '"Dubai", "IBM Plex Sans Arabic", "Noto Sans Arabic", Tahoma, sans-serif',
} as const;

/**
 * The type scale is published twice by §4.6: as a `calc()` chain derived from
 * `--font-size-base` and `--font-scale-ratio`, and as static rem values at the
 * defaults. The static values are emitted, because a nine-deep `pow()` chain is
 * not supported uniformly and a rounded rem is stable under zoom; the base and
 * ratio remain tokens so the Appearance module's controls still write them.
 */
export const typography = {
  fontSans: fontStacks["ibm-plex-sans"],
  fontMono: fontStacks["ibm-plex-mono"],
  fontArabic: fontStacks["ibm-plex-sans-arabic"],
  fontSizeBase: "0.875rem",
  fontScaleRatio: "1.2",

  text2xs: "0.6875rem",
  textXs: "0.75rem",
  textSm: "0.8125rem",
  textBase: "0.875rem",
  textMd: "1rem",
  textLg: "1.125rem",
  textXl: "1.375rem",
  text2xl: "1.75rem",
  text3xl: "2.125rem",

  leadingTight: "1.2",
  leadingSnug: "1.35",
  leadingNormal: "1.5",
  leadingRelaxed: "1.65",
  // Arabic diacritics and deep descenders collide at Latin leading (§11.4).
  leadingArabic: "1.75",

  fontWeightRegular: "400",
  fontWeightMedium: "500",
  fontWeightSemibold: "600",
  fontWeightBold: "700",

  trackingTight: "-0.011em",
  trackingNormal: "0",
  // Uppercase micro-labels only, and never applied to Arabic — letter-spacing
  // breaks cursive joining (§11.4).
  trackingWide: "0.04em",
} as const;

// ---------------------------------------------------------------------------
// §4.7 Spacing and density (21)
// ---------------------------------------------------------------------------

/**
 * One unit, a 14-step scale, and a single multiplier that is the entire density
 * implementation: because every component's padding, gap and height is a scale
 * token, changing `--density-scale` recompacts every screen at once with no
 * component knowing density exists.
 *
 * `--space-px` is excluded from the multiplier so hairline borders never render
 * at 0.75px.
 *
 * §4.7's block enumerates 21 tokens; the appendix's per-category total says 22.
 * The enumeration is treated as authoritative — inventing a 22nd token to match
 * an arithmetic total would put a token in the system that nothing consumes.
 */
export const spacing = {
  spaceUnit: "0.25rem",
  densityScale: "1",
  space0: "0",
  spacePx: "1px",
  space1: "calc(var(--space-unit) * 1 * var(--density-scale))",
  space2: "calc(var(--space-unit) * 2 * var(--density-scale))",
  space3: "calc(var(--space-unit) * 3 * var(--density-scale))",
  space4: "calc(var(--space-unit) * 4 * var(--density-scale))",
  space5: "calc(var(--space-unit) * 5 * var(--density-scale))",
  space6: "calc(var(--space-unit) * 6 * var(--density-scale))",
  space8: "calc(var(--space-unit) * 8 * var(--density-scale))",
  space10: "calc(var(--space-unit) * 10 * var(--density-scale))",
  space12: "calc(var(--space-unit) * 12 * var(--density-scale))",
  space16: "calc(var(--space-unit) * 16 * var(--density-scale))",
  space20: "calc(var(--space-unit) * 20 * var(--density-scale))",
  space24: "calc(var(--space-unit) * 24 * var(--density-scale))",

  controlHeightSm: "calc(1.5rem + var(--space-2))",
  controlHeightMd: "calc(1.75rem + var(--space-3))",
  controlHeightLg: "calc(2rem + var(--space-4))",
  rowHeight: "calc(2rem + var(--space-4))",
  pageGutter: "var(--space-6)",
} as const;

/**
 * The two density stops (§4.7). Applied through `[data-density]` on `<html>`,
 * not through `:root`, which is why a skin's `geometry.density` becomes an HTML
 * attribute and is deliberately *not* emitted as a custom property — an
 * attribute rule outranks `:root`, so emitting both would leave the lower-
 * specificity one silently ignored.
 */
export const DENSITY_SCALE: Readonly<Record<"compact" | "comfortable", string>> = {
  compact: "0.75",
  comfortable: "1",
} as const;

// ---------------------------------------------------------------------------
// §4.8 Radius (8), shadow (8), z-index (8), motion (10)
// ---------------------------------------------------------------------------

/**
 * One root token drives the whole system, so the Appearance module's radius
 * slider is a single write. `--radius-full` is fixed: a pill that stops being a
 * pill is a different component.
 */
export const radius = {
  radiusRoot: "0.5rem",
  radiusXs: "calc(var(--radius-root) * 0.25)",
  radiusSm: "calc(var(--radius-root) * 0.5)",
  radiusMd: "calc(var(--radius-root) * 0.75)",
  radiusLg: "var(--radius-root)",
  radiusXl: "calc(var(--radius-root) * 1.5)",
  radius2xl: "calc(var(--radius-root) * 2)",
  radiusFull: "9999px",
} as const;

/** The four radius stops the Appearance module's slider offers (§4.8, §7.2). */
export const RADIUS_ROOT_STOPS = ["0rem", "0.25rem", "0.5rem", "0.875rem"] as const;

/**
 * Depth is a multiplier, so a flat theme is one token change rather than a
 * per-component override. At depth 0 the system must stay legible from borders
 * alone, which is why `--border-strong` exists as a separate 3:1 token.
 */
export const shadow = {
  shadowDepth: "1",
  shadowColor: "32 36 43",
  shadowXs: "0 1px 1px rgb(var(--shadow-color) / calc(0.05 * var(--shadow-depth)))",
  shadowSm:
    "0 1px 2px rgb(var(--shadow-color) / calc(0.07 * var(--shadow-depth))), 0 1px 1px rgb(var(--shadow-color) / calc(0.04 * var(--shadow-depth)))",
  shadowMd:
    "0 2px 6px rgb(var(--shadow-color) / calc(0.08 * var(--shadow-depth))), 0 1px 2px rgb(var(--shadow-color) / calc(0.05 * var(--shadow-depth)))",
  shadowLg:
    "0 8px 20px rgb(var(--shadow-color) / calc(0.10 * var(--shadow-depth))), 0 2px 6px rgb(var(--shadow-color) / calc(0.06 * var(--shadow-depth)))",
  shadowXl:
    "0 18px 44px rgb(var(--shadow-color) / calc(0.14 * var(--shadow-depth))), 0 4px 12px rgb(var(--shadow-color) / calc(0.08 * var(--shadow-depth)))",
  shadowInset: "inset 0 1px 2px rgb(var(--shadow-color) / calc(0.06 * var(--shadow-depth)))",
} as const;

/** Shadow colour deepens in dark mode (§4.8). The only mode-dependent non-colour token. */
export const SHADOW_COLOR_BY_MODE: Readonly<Record<ColorMode, string>> = {
  light: shadow.shadowColor,
  dark: "4 6 9",
} as const;

/** The four shadow-depth stops (§4.8, §7.2). */
export const SHADOW_DEPTH_STOPS = [0, 0.5, 1, 1.6] as const;

/** Named layers. A numeric `z-index` in feature code fails lint (§4.8, §12.2). */
export const zIndex = {
  zBase: "0",
  zDropdown: "1000",
  zSticky: "1100",
  zOverlay: "1200",
  zModal: "1300",
  zPopover: "1400",
  zToast: "1500",
  // Always topmost, since a tooltip may explain a toast.
  zTooltip: "1600",
} as const;

/**
 * Durations collapse rather than transitions being removed under
 * `prefers-reduced-motion`, so state changes still *complete* — a switch still
 * lands on. `--motion-scale` is the separate signal for non-transitional
 * motion, which a duration override cannot fix (§4.8).
 */
export const motion = {
  durationInstant: "50ms",
  durationFast: "120ms",
  durationNormal: "200ms",
  durationSlow: "320ms",
  durationSlower: "480ms",
  easeStandard: "cubic-bezier(0.2, 0, 0, 1)",
  easeOut: "cubic-bezier(0, 0, 0.2, 1)",
  easeIn: "cubic-bezier(0.4, 0, 1, 1)",
  easeEmphasised: "cubic-bezier(0.3, 0, 0, 1)",
  motionScale: "1",
} as const;

/** Reduced-motion overrides (§4.8). Emitted inside the media query, not `:root`. */
export const REDUCED_MOTION_OVERRIDES = {
  motionScale: "0",
  durationInstant: "1ms",
  durationFast: "1ms",
  durationNormal: "1ms",
  durationSlow: "1ms",
  durationSlower: "1ms",
} as const;

// ---------------------------------------------------------------------------
// §4.9 Breakpoints (4) — the one non-runtime category
// ---------------------------------------------------------------------------

/**
 * Not runtime-themable, and stated plainly rather than fudged: CSS custom
 * properties cannot appear in a media query condition, so these are build-time
 * values for the Tailwind config. They are exported for that consumer and are
 * excluded from every CSS emission in `css.ts`.
 */
export const breakpoints = {
  bpSm: "560px",
  bpMd: "820px",
  bpLg: "1080px",
  bpXl: "1400px",
} as const;

// ---------------------------------------------------------------------------
// Aggregate view
// ---------------------------------------------------------------------------

/** Every layer-2 token that is emitted as a custom property, for one mode. */
export type SemanticTokenSet = Readonly<Record<string, string>>;

/**
 * The full layer-2 set for a mode: colours plus the mode-independent
 * categories, with the one mode-dependent non-colour token (`--shadow-color`)
 * substituted. This is what `css.ts` emits as the base stylesheet, and what a
 * skin's values are merged over.
 */
export function semanticTokens(mode: ColorMode): SemanticTokenSet {
  return {
    ...semanticColors[mode],
    ...typography,
    ...spacing,
    ...radius,
    ...shadow,
    shadowColor: SHADOW_COLOR_BY_MODE[mode],
    ...zIndex,
    ...motion,
  };
}

/**
 * Names of every layer-2 token that may be emitted. Breakpoints are absent by
 * construction (§4.9), which is what stops a caller emitting a token that
 * cannot work.
 */
export const SEMANTIC_TOKEN_NAMES: readonly string[] = Object.keys(semanticTokens("light"));
