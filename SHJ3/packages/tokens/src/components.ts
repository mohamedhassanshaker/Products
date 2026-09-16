/**
 * Layer 3 — component tokens (`design-system.md` §4.10, §3.3).
 *
 * Per-component knobs, derived from layer 2 and never from literals, so a
 * layer-2 change propagates without touching this file. The few values that are
 * genuinely geometric rather than derived (`--sidebar-width`, the 2px focus ring)
 * are the exceptions §4.10 publishes as such.
 *
 * A skin may set only the six tokens on `SKINNABLE_COMPONENT_TOKENS` — the ones
 * the Appearance module exposes (§4.10 ▲). The rest are internal to the owning
 * component, which is what keeps an imported skin from reaching into component
 * internals it has no contract with.
 */

/**
 * §4.10 tabulates 40 tokens while its heading says 38; the enumeration is
 * treated as authoritative. `--chat-bubble-max-inline-size` is the 41st: §3.3
 * publishes it and `ChatThread` consumes it (§5.5 #48), but §4.10's table omits
 * it, so it is included here rather than left undefined at the point of use.
 */
export const componentTokens = {
  buttonRadius: "var(--radius-md)",
  buttonHeightSm: "var(--control-height-sm)",
  buttonHeightMd: "var(--control-height-md)",
  buttonHeightLg: "var(--control-height-lg)",
  buttonPaddingInline: "var(--space-4)",

  inputRadius: "var(--radius-sm)",
  // `--border-strong`, not `--border`: an input's boundary is a control
  // boundary and must clear WCAG 1.4.11's 3:1 (§4.1, §10.2).
  inputBorder: "var(--border-strong)",
  inputHeight: "var(--control-height-md)",

  badgeRadius: "var(--radius-full)",
  badgePaddingInline: "var(--space-2)",
  badgeFontSize: "var(--text-2xs)",

  cardRadius: "var(--radius-lg)",
  cardBorder: "var(--border)",
  cardPadding: "var(--space-4)",
  cardShadow: "var(--shadow-sm)",

  sidebarWidth: "16rem",
  sidebarWidthCollapsed: "3.5rem",
  sidebarItemRadius: "var(--radius-md)",
  sidebarStyle: '"neutral"',

  chatBubbleRadius: "var(--radius-lg)",
  chatBubbleMaxInlineSize: "34rem",

  tableRowHeight: "var(--row-height)",
  tableHeaderSurface: "var(--muted)",
  tableCellPaddingInline: "var(--space-3)",
  tableBorder: "var(--border)",
  tableStickyShadow: "var(--shadow-xs)",

  // 43px at comfortable density, 38px at compact — the smallest target in the
  // system, and both clear WCAG 2.5.8's 24px floor (§10.5).
  matrixCellSize: "calc(var(--row-height) * 0.9)",
  matrixHeaderInlineSize: "14rem",

  graphNodeRadius: "var(--radius-sm)",
  graphEdgeStroke: "var(--border-strong)",
  graphCanvasSurface: "var(--card)",
  graphGridLine: "var(--border)",

  flowNodeInlineSize: "13rem",
  // Mirrors `graphEdgeStroke`'s own value — a distinct, named component token
  // rather than `FlowCanvas` reaching across into `GraphCanvas`'s token,
  // matching this file's own per-organism-token convention (see
  // `graphNodeRadius`/`cardRadius` both resolving from the same radius scale
  // under different names, so a skin/token change to one can never silently
  // move the other).
  flowCanvasEdgeStroke: "var(--border-strong)",
  // xyflow requires its own explicit, non-percentage height on the immediate
  // wrapper it measures (a percentage height needs the same of every
  // ancestor, which this organism's callers cannot guarantee) — a real
  // geometric viewport constraint, not a colour/spacing value, so a `clamp()`
  // off `100dvh` (not a fixed rem figure) is the correct token shape here,
  // matching `flow-canvas-mobile-sheet.tsx`'s own `85vh` reasoning and
  // `help-guide-shell.tsx`'s own `100dvh` precedent. A flat `32rem` (§the
  // product owner's own live screenshot) left most of a real viewport as dead
  // whitespace below the canvas — this instead fills the available viewport
  // height (minus real chrome above the canvas: header, breadcrumb, the
  // wizard/flow-designer page's own heading, entry/escape summary, warning
  // banners, the canvas/outline toggle and R3 strip) down to a comfortable
  // floor (`28rem`, close to the old fixed value, for a very short viewport)
  // and a ceiling (`56rem`) so it does not grow absurdly tall on a very
  // large display.
  flowCanvasGraphBlockSize: "clamp(24rem, 100dvh - 32rem, 52rem)",
  wizardStepIndicatorSize: "1.5rem",

  subtabUnderlineThickness: "2px",
  subtabGap: "var(--space-5)",

  summaryStripSurface: "var(--surface-sunken)",
  summaryStripBorderInlineStart: "3px solid var(--border-strong)",

  progressTrackHeight: "6px",
  focusRingWidth: "2px",
  focusRingOffset: "2px",
} as const;

export type ComponentTokenName = keyof typeof componentTokens;

/**
 * The layer-3 tokens a skin is allowed to carry (§4.10 ▲, §3.1's asymmetry).
 * `sidebarWidth` and `sidebarStyle` come from the Brand section of the
 * Appearance module, the card pair from Layout, the ring pair from focus.
 */
export const SKINNABLE_COMPONENT_TOKENS = [
  "cardRadius",
  "cardShadow",
  "sidebarWidth",
  "sidebarStyle",
  "focusRingWidth",
  "focusRingOffset",
] as const satisfies readonly ComponentTokenName[];

export type SkinnableComponentTokenName = (typeof SKINNABLE_COMPONENT_TOKENS)[number];

export const COMPONENT_TOKEN_NAMES = Object.keys(componentTokens) as readonly ComponentTokenName[];
