/**
 * The contrast pair matrix (`design-system.md` §10.2).
 *
 * §10.2 is explicit that "the pair matrix is **data, not code**", and that
 * "adding a semantic token without adding its pairs fails the test in §12.4, so
 * the gate cannot silently fall behind the token set". Hence a separate module
 * whose only job is the list, and a coverage assertion in the test suite that
 * every colour role is either in a pair or on the exemption list below.
 *
 * Most pairs are transcribed from §8.1 and §8.2, which publish a measured ratio
 * for each. Eight pairs are not in those tables but are required by the
 * coverage rule; each is marked and its surface is the one §4 states the token
 * is drawn on. They are additions to the matrix, not to the token set — no new
 * token or value is introduced by this file.
 */

import type { ContrastPair } from "./contrast.js";
import type { SemanticColorTokenName } from "./semantic.js";

export const CONTRAST_PAIRS: readonly ContrastPair[] = [
  // ---- Surfaces and body text -------------------------------------------
  { fg: "foreground", bg: "background", class: "text", note: "Body text on the page ground" },
  { fg: "foreground", bg: "surfaceSunken", class: "text", note: "§4.1 — text in a recessed well" },
  { fg: "foreground", bg: "input", class: "text", note: "§4.1 — value text in a field" },
  { fg: "cardForeground", bg: "card", class: "text", note: "Text on a card, canvas or dialog" },
  { fg: "popoverForeground", bg: "popover", class: "text", note: "Dropdown, tooltip, inspector" },
  { fg: "mutedForeground", bg: "background", class: "text", note: "Meta text on the page ground" },
  { fg: "mutedForeground", bg: "card", class: "text", note: "Meta text on a card" },
  {
    fg: "mutedForeground",
    bg: "muted",
    class: "text",
    note: "Meta text on a muted strip; also the placeholder colour",
  },

  // ---- Brand -------------------------------------------------------------
  { fg: "primary", bg: "background", class: "text", note: "Primary-coloured label or link" },
  { fg: "primary", bg: "card", class: "text", note: "Primary-coloured label on a card" },
  { fg: "primaryForeground", bg: "primary", class: "text", note: "Primary button label" },
  {
    fg: "primaryForeground",
    bg: "primaryHover",
    class: "text",
    note: "§4.2 — the same label over the hover fill",
  },
  { fg: "secondaryForeground", bg: "secondary", class: "text", note: "Secondary button label" },
  {
    fg: "accentForeground",
    bg: "accent",
    class: "text",
    note: "Label on a brand-tinted selection surface",
  },

  // ---- Status: fill labels and the -strong text variants ------------------
  { fg: "successForeground", bg: "success", class: "text", note: "Label on a success fill" },
  { fg: "successStrong", bg: "successSubtle", class: "text", note: "Success badge label" },
  { fg: "warningForeground", bg: "warning", class: "text", note: "Label on a warning fill" },
  { fg: "warningStrong", bg: "warningSubtle", class: "text", note: "Warning badge label" },
  {
    fg: "destructiveForeground",
    bg: "destructive",
    class: "text",
    note: "Label on a destructive fill",
  },
  {
    fg: "destructiveStrong",
    bg: "destructiveSubtle",
    class: "text",
    note: "Destructive badge label",
  },
  {
    fg: "destructiveStrong",
    bg: "background",
    class: "text",
    note: "§6.3 — the case the -strong variant exists for: error text on the page ground",
  },
  { fg: "infoForeground", bg: "info", class: "text", note: "Label on an info fill" },
  { fg: "infoStrong", bg: "infoSubtle", class: "text", note: "Info badge label" },

  // ---- Assistant surface -------------------------------------------------
  { fg: "chatUserBubbleForeground", bg: "chatUserBubble", class: "text", note: "User turn text" },
  {
    fg: "chatAssistantBubbleForeground",
    bg: "chatAssistantBubble",
    class: "text",
    note: "Assistant turn text",
  },
  {
    fg: "chatMetaForeground",
    bg: "chatUserBubble",
    class: "text",
    note: "Message meta row on a user turn",
  },
  {
    fg: "chatMetaForeground",
    bg: "chatAssistantBubble",
    class: "text",
    note: "Message meta row on an assistant turn",
  },
  {
    fg: "chatDisclaimerForeground",
    bg: "chatDisclaimer",
    class: "text",
    note: "A1's disclaimer banner",
  },
  {
    fg: "chatTyping",
    bg: "background",
    class: "text",
    note: '§4.4 — A3\'s "Still thinking…" indicator, which is text',
  },
  {
    fg: "foreground",
    bg: "chatComposer",
    class: "text",
    note: "§4.4 — what the user is typing, in the composer field",
  },

  // ---- Sidebar, code, selection ------------------------------------------
  { fg: "sidebarForeground", bg: "sidebar", class: "text", note: "Navigation item label" },
  {
    fg: "sidebarMutedForeground",
    bg: "sidebar",
    class: "text",
    note: "Navigation group header",
  },
  {
    fg: "sidebarForeground",
    bg: "sidebarActiveSurface",
    class: "text",
    note: "Active navigation item label",
  },
  { fg: "codeForeground", bg: "codeSurface", class: "text", note: "Monospace payloads and traces" },
  { fg: "selectionForeground", bg: "selection", class: "text", note: "Selected text" },

  // ---- Chart series ------------------------------------------------------
  // Every series must clear 4.5:1 on `card` so a value label can sit on the
  // mark (§4.5), which is why these are text pairs rather than non-text.
  { fg: "chart1", bg: "card", class: "text", note: "Categorical series 1 with a direct label" },
  { fg: "chart2", bg: "card", class: "text", note: "Categorical series 2 with a direct label" },
  { fg: "chart3", bg: "card", class: "text", note: "Categorical series 3 with a direct label" },
  { fg: "chart4", bg: "card", class: "text", note: "Categorical series 4 with a direct label" },
  { fg: "chart5", bg: "card", class: "text", note: "Categorical series 5 with a direct label" },
  { fg: "chart6", bg: "card", class: "text", note: "Categorical series 6 with a direct label" },

  // ---- Non-text: control boundaries and state indicators (WCAG 1.4.11) ----
  {
    fg: "borderStrong",
    bg: "background",
    class: "non-text",
    note: "Input, switch and checkbox boundaries on the page ground",
  },
  {
    fg: "borderStrong",
    bg: "card",
    class: "non-text",
    note: "Table cell grid and control boundaries on a card",
  },
  { fg: "ring", bg: "background", class: "non-text", note: "Focus ring on the page ground" },
  { fg: "ring", bg: "card", class: "non-text", note: "Focus ring on a card" },
  {
    fg: "sidebarAccent",
    bg: "sidebar",
    class: "non-text",
    note: "§4.5 — the active-item marker, a state indicator",
  },
] as const;

/**
 * Colour roles with no pair, each for a stated reason (§10.2's "explicitly
 * exempt, by name" row). The gate reports that they were skipped and why,
 * rather than skipping them silently — an exemption nobody can see is
 * indistinguishable from a gap.
 */
export const CONTRAST_EXEMPTIONS: Readonly<Record<string, string>> = {
  border: "Decorative divider and card hairline only; never a control boundary (§4.1, §10.2)",
  sidebarBorder: "Decorative divider, same class as `border`",
  ringOffset:
    "The focus ring's halo. It tracks `background` and is not a foreground on a surface (§4.1, §10.3)",
  overlay: "Modal scrim; carries no text and no boundary (§10.2)",
  skeleton: "Loading placeholder; carries no text (§10.2)",
  disabledSurface: "WCAG 1.4.3 excludes disabled controls (§4.5, §10.2)",
  disabledForeground:
    "WCAG 1.4.3 excludes disabled controls, and a disabled control that looks enabled is the worse failure (§4.5)",
} as const;

export const EXEMPT_COLOR_TOKENS: ReadonlySet<SemanticColorTokenName> = new Set(
  Object.keys(CONTRAST_EXEMPTIONS) as SemanticColorTokenName[],
);

/**
 * Pairs that exist visually but are deliberately not gated, with the reason the
 * report must state (§8.1, §8.2, §10.2). `card` against `background` is the
 * important one: surface separation is carried by `border` and `shadow`, not by
 * contrast, so measuring it would fail a design that is correct.
 */
export const CONTRAST_EXEMPT_PAIRS: readonly {
  readonly fg: SemanticColorTokenName;
  readonly bg: SemanticColorTokenName;
  readonly reason: string;
}[] = [
  { fg: "border", bg: "background", reason: "Decorative divider (§8.1, §8.2)" },
  { fg: "border", bg: "card", reason: "Decorative divider (§8.1)" },
  {
    fg: "card",
    bg: "background",
    reason: "Surface separation is carried by border and shadow, not contrast (§8.2)",
  },
  {
    fg: "disabledForeground",
    bg: "disabledSurface",
    reason: "WCAG 1.4.3 excludes disabled controls (§4.5, §8.1)",
  },
] as const;
