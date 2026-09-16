/**
 * Fixed, non-themable WhatsApp chrome colours (design-system.md §5.5 #50:
 * *"Colours come from a fixed, non-themable whatsapp token block — a tenant
 * may not re-brand WhatsApp's chrome, and the skin schema rejects attempts
 * to."*).
 *
 * This is the one deliberate, documented exception to "tokens only" in this
 * wave — WhatsApp's own brand chrome is not a design decision this system
 * owns, so it cannot be expressed as a `--chat-*` semantic token a tenant
 * skin could ever legitimately override. Each literal below carries the
 * gate's own documented escape hatch on its own line (`design-gate-allow:`),
 * exactly the mechanism `chip-input.tsx` already established in the
 * molecules wave — not a parallel exemption list, not an entry in
 * `ALLOWED_PREFIXES` in `scripts/gates/no-hardcoded-design-values.mjs` (that
 * would silently exempt this entire file from every *other* rule too, far
 * broader than the one narrow exception actually needed here).
 *
 * Representative WhatsApp brand values, not pulled from any design token —
 * intentionally, since there is no token for a brand this system does not
 * own. `AssistantWidgetShell` is this constant's only consumer; it flows
 * down into `ChatThread`'s own `bubbleColorOverrides` prop rather than
 * `ChatThread` hardcoding any WhatsApp knowledge of its own.
 */
export const WHATSAPP_CHROME_COLORS = {
  /** Business header bar background. */
  headerBackground: "#008069", // design-gate-allow: WhatsApp brand chrome is fixed and non-themable per design-system.md §5.5 #50 — not a design token by definition
  headerForeground: "#FFFFFF", // design-gate-allow: WhatsApp brand chrome is fixed and non-themable per design-system.md §5.5 #50 — not a design token by definition
  /** Chat area background ("wallpaper"). */
  wallpaperBackground: "#E5DDD5", // design-gate-allow: WhatsApp brand chrome is fixed and non-themable per design-system.md §5.5 #50 — not a design token by definition
  /** Outgoing (user) bubble. */
  outgoingBubble: "#DCF8C6", // design-gate-allow: WhatsApp brand chrome is fixed and non-themable per design-system.md §5.5 #50 — not a design token by definition
  outgoingBubbleForeground: "#111B21", // design-gate-allow: WhatsApp brand chrome is fixed and non-themable per design-system.md §5.5 #50 — not a design token by definition
  /** Incoming (assistant) bubble. */
  incomingBubble: "#FFFFFF", // design-gate-allow: WhatsApp brand chrome is fixed and non-themable per design-system.md §5.5 #50 — not a design token by definition
  incomingBubbleForeground: "#111B21", // design-gate-allow: WhatsApp brand chrome is fixed and non-themable per design-system.md §5.5 #50 — not a design token by definition
  /** The 24-hour session-window marker's accent. */
  accent: "#25D366", // design-gate-allow: WhatsApp brand chrome is fixed and non-themable per design-system.md §5.5 #50 — not a design token by definition
} as const;
