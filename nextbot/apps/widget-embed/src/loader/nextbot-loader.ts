/**
 * `NextBot.init({...})` — the host-page-facing embed API (screen inventory A.3.1,
 * FR-OC-01). Deliberately vanilla JS/DOM only, no React/Chakra/Zustand import (see
 * `vite.loader.config.ts`'s doc comment) — this file is bundled standalone as an
 * IIFE any host page can `<script src>` regardless of its own stack.
 *
 * Responsibilities, and only these:
 *  1. Fail-closed config validation (`tenantId` required) — per FR-OC-01, a missing
 *     `tenantId` logs `NEXTBOT_INIT_ERROR` and mounts nothing at all.
 *  2. Inject a single iframe hosting the entire widget UI (launcher + window are
 *     both states *inside* that one iframe document — `docs/design/UX_GUIDELINES.md`
 *     §5.1) at whatever `position` the embed config specifies.
 *  3. Relay `nextbot:resize` postMessages from the iframe to resize/reposition the
 *     iframe element itself between its collapsed-launcher and expanded-window
 *     footprints (the only two sizes the outer page ever needs to know about).
 *
 * Everything else (session bootstrap, message rendering, SSE, offline queue) lives
 * entirely inside the iframe's own document (the separate widget SPA build).
 */

export type WidgetPosition = "bottom-right" | "bottom-left" | "top-right" | "top-left";

export interface NextBotInitConfig {
  tenantId: string;
  channelId: string;
  position?: WidgetPosition;
  language?: string;
  direction?: "auto" | "ltr" | "rtl";
  theme?: Record<string, unknown>;
  quickActions?: Array<{ label: string; labelAr?: string; request: string }>;
  menu?: Record<string, unknown>;
  proactiveNudge?: Record<string, unknown>;
  /** Test/deploy override for where the widget SPA's `index.html` lives — defaults
   * to a `widget/` subpath relative to this loader script's own URL. */
  baseUrl?: string;
  /**
   * Phase 6 (client-feedback-batch item 9) — Admin Console "test in sandbox before
   * promoting" preview mode ONLY. A real customer-facing embed snippet
   * (`apps/web`'s `ChannelsList.tsx`'s generated `NextBot.init({...})` snippet) never
   * sets these two fields, and setting them here alone proves nothing: the widget's
   * session-init call (`api.ts`) forwards both to the Gateway Plane, which
   * independently verifies `previewToken` server-side (`apps/gateway`'s session
   * route, via `@nextbot/iam`) before honoring `previewVersionId` at all — this
   * loader has no way to enforce anything, it only threads the values through
   * unchanged into the iframe's URL, exactly like every other `NextBotInitConfig`
   * field. See `ChatPreviewPanel.tsx` for the only real caller of this preview mode.
   */
  previewVersionId?: string;
  /** Pairs with `previewVersionId` above — see its doc. */
  previewToken?: string;
}

const COLLAPSED_SIZE = { width: "64px", height: "64px" };
const IFRAME_ID = "nextbot-widget-iframe";

/**
 * D1 fix (QA fix pass): `document.currentScript` is **only** non-null while the
 * currently-executing `<script>` tag's own top-level code is running — the instant
 * this module's IIFE finishes evaluating (i.e. by the time a host page's own code
 * calls `NextBot.init({...})`), `document.currentScript` has already reverted to
 * whatever script is executing *then*. The spec's own worked example (screen
 * inventory §A.3.1) calls `init()` from a **separate, later inline `<script>`
 * block** — at that point `document.currentScript` resolves to *that* inline
 * script (whose `.src` is `""`, not `undefined`, so `?? window.location.href`
 * never engages), and `new URL("./widget/", "")` throws uncaught, silently killing
 * the entire embed.
 *
 * The fix: read `document.currentScript` exactly once, synchronously, at the top
 * level of this module — i.e. while *this* loader's own `<script src="nextbot.js">`
 * tag is still the one executing — and cache it. Every later call to `init()`
 * (from anywhere) then resolves the widget base URL from this cached reference
 * instead of re-reading a DOM property whose value is only meaningful during this
 * module's own synchronous evaluation.
 */
const LOADER_SCRIPT: HTMLScriptElement | null = document.currentScript as HTMLScriptElement | null;

const POSITION_STYLE: Record<WidgetPosition, Partial<CSSStyleDeclaration>> = {
  "bottom-right": { bottom: "16px", right: "16px", top: "", left: "" },
  "bottom-left": { bottom: "16px", left: "16px", top: "", right: "" },
  "top-right": { top: "16px", right: "16px", bottom: "", left: "" },
  "top-left": { top: "16px", left: "16px", bottom: "", right: "" },
};

/** FR-OC-01 fail-closed init-error path — a missing `tenantId` never mounts any DOM. */
function logInitError(field: string): void {
  console.error(`NEXTBOT_INIT_ERROR: ${field} is required`);
}

function resolveWidgetBaseUrl(config: NextBotInitConfig): string {
  if (config.baseUrl) return config.baseUrl.endsWith("/") ? config.baseUrl : `${config.baseUrl}/`;
  // D1: use the module-load-time-captured script reference, never a lazy
  // `document.currentScript` read here — see `LOADER_SCRIPT`'s doc comment above.
  // `.src` is only trustworthy when non-empty (a script with no `src` attribute,
  // e.g. an inline bundle, still yields `""` rather than `undefined`).
  const scriptSrc = LOADER_SCRIPT?.src || window.location.href;
  // QA Final Review B3: the real deployed static-file layout
  // (`apps/widget-embed/nginx.conf`) serves this loader at `/loader/nextbot.js`
  // and the widget SPA at `/widget/index.html` — `/loader/` and `/widget/` are
  // SIBLING directories under the same web root, not nested. Resolving
  // `"./widget/"` relative to the loader's own URL therefore produced
  // `/loader/widget/index.html` (a 404); `"../widget/"` correctly walks up out of
  // `/loader/` to the shared root before descending into the sibling `/widget/`.
  return new URL("../widget/", scriptSrc).toString();
}

/** Base64url-encodes the JSON-serializable embed config for the iframe's URL query
 * string — avoids any postMessage-timing race between the iframe's first paint and
 * the parent delivering its config. */
function encodeConfig(config: NextBotInitConfig): string {
  const json = JSON.stringify(config);
  // btoa is UTF-16-unsafe for non-Latin1 text (e.g. Arabic quick-action labels) —
  // encodeURIComponent first, matching the standard "unicode-safe base64" idiom.
  return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16))));
}

function buildIframeSrc(config: NextBotInitConfig): string {
  const base = resolveWidgetBaseUrl(config);
  const params = new URLSearchParams({
    tenantId: config.tenantId,
    channelId: config.channelId,
    config: encodeConfig(config),
  });
  return `${base}index.html?${params.toString()}`;
}

function applyCollapsedGeometry(iframe: HTMLIFrameElement, position: WidgetPosition): void {
  Object.assign(iframe.style, POSITION_STYLE[position], COLLAPSED_SIZE);
}

interface ResizeMessage {
  type: "nextbot:resize";
  state: "collapsed" | "expanded";
  width: string;
  height: string;
}

function isResizeMessage(data: unknown): data is ResizeMessage {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { type?: unknown }).type === "nextbot:resize" &&
    typeof (data as { width?: unknown }).width === "string" &&
    typeof (data as { height?: unknown }).height === "string"
  );
}

/**
 * Mounts (or re-mounts, if called again — idempotent) the widget iframe on the
 * current page.
 * @throws nothing — a validation failure logs `NEXTBOT_INIT_ERROR` and returns.
 */
export function init(config: NextBotInitConfig): void {
  if (!config?.tenantId) {
    logInitError("tenantId");
    return;
  }
  if (!config.channelId) {
    logInitError("channelId");
    return;
  }

  const position = config.position ?? "bottom-right";
  const existing = document.getElementById(IFRAME_ID) as HTMLIFrameElement | null;
  const iframe = existing ?? document.createElement("iframe");
  iframe.id = IFRAME_ID;
  // §5.5: a static title, never mutated across state changes.
  iframe.title = "NextBot chat widget";
  iframe.setAttribute("allow", "clipboard-write; microphone");
  iframe.style.position = "fixed";
  iframe.style.zIndex = "2147483000";
  iframe.style.border = "none";
  iframe.style.background = "transparent";
  iframe.style.colorScheme = "normal";
  applyCollapsedGeometry(iframe, position);
  iframe.src = buildIframeSrc(config);

  if (!existing) {
    document.body.appendChild(iframe);
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.source !== iframe.contentWindow) return;
      if (!isResizeMessage(event.data)) return;
      iframe.style.width = event.data.width;
      iframe.style.height = event.data.height;
    });
  }
}

declare global {
  interface Window {
    NextBot?: { init: typeof init };
  }
}

window.NextBot = { init };
