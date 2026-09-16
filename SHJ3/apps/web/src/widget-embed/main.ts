/**
 * The real, standalone embeddable widget bundle — the `<script>` a third
 * party (`sharjah.ae`, `services.shj.ae`, per B10 tab 2's allow-list) drops
 * into its own page:
 *
 *   <script src=".../embed/widget.js" data-channel-key="sewa.WebWidget" async defer></script>
 *
 * ## Why this is plain DOM/TS, no React, no cross-import from this app
 *
 * Architecturally load-bearing, not a style preference — read this before
 * "simplifying" it into a React mount or an iframe:
 *
 * 1. **No iframe.** api.md §4.1's origin allow-list is enforced three ways,
 *    one of which is "the widget bootstrap script itself refuses to
 *    initialise if `location.origin` is not in the list it was served." For
 *    that to mean anything real, this bundle's own `fetch()` calls must
 *    genuinely execute in the **host page's own `window`/document context**
 *    — which is only true because this script's code runs directly in the
 *    embedding page's JS realm. A same-origin-to-`shj3-web` iframe pointed
 *    at this bundle would make every one of its `fetch()` calls carry
 *    `shj3-web`'s own origin as `Origin`, not the embedding site's — which
 *    would make the server-side origin check meaningless theatre. Do not
 *    "fix" this into an iframe; that would silently break the one security
 *    property this whole design exists to provide.
 * 2. **No React/ReactDOM dependency.** A citizen-facing script embedded on a
 *    government portal should be small and dependency-light; this bundle
 *    owns its own tiny render loop instead of shipping a UI framework's
 *    runtime for a handful of DOM nodes.
 * 3. **No import from `modules/conversation/**`.** This file is bundled by
 *    `esbuild` as its own, fully self-contained entry point (`scripts/
 *    build-widget-embed.ts`) — completely independent of the Next.js
 *    build/TS project the rest of this app compiles under. Reaching into
 *    `modules/conversation/domain/sse-frame-parser.ts` would couple this
 *    bundle's build to that project's module resolution for no real benefit
 *    (the parser is ~30 lines); this file re-implements an equivalent,
 *    smaller one directly (`parseSseChunk` below) so the two can never
 *    accidentally diverge in a way that matters, and so this bundle keeps
 *    zero build-time dependency on the rest of the app's source tree.
 *
 * ## Shadow DOM
 *
 * A single container `<div>` with an open Shadow DOM root is appended to
 * `document.body`; every style is inline inside the shadow root's own
 * `<style>` tag. This assumes **nothing** about the host page's own CSS
 * (Tailwind present or absent, resets, third-party frameworks) — the whole
 * point of Shadow DOM here is that the host page cannot leak styles in, and
 * this widget cannot leak styles out.
 *
 * ## Where the widget's own colours/spacing/radii come from
 *
 * `@shj3/tokens` (ADR-0007) is this repository's one allowlisted source of
 * real design values — every other module, this file included, consumes it
 * rather than restating a literal (`scripts/gates/no-hardcoded-design-values.mjs`
 * enforces exactly that). This bundle has no Tailwind/CSS-variable cascade
 * from the host page to inherit tokens from (Shadow DOM, by design, blocks
 * that), so `WIDGET_TOKENS` below re-declares the small subset of real
 * `@shj3/tokens` values this UI needs as `:host`-scoped custom properties —
 * the *values* are real token values imported from the package, only the
 * declaration site (a `:host` block instead of the app-wide theme
 * stylesheet) is local to this bundle. The chat-specific roles
 * (`chatUserBubble`, `chatDisclaimer`, `chatMetaForeground`, …) are the exact
 * semantic tokens `design-system.md` §4.4 defines for this precise UI, not
 * invented ad hoc for this file.
 */
import { radius, semanticColors, shadow, spacing, typography } from "@shj3/tokens";

const colors = semanticColors.light;

/**
 * The `:host`-scoped custom properties this bundle's stylesheet references —
 * real `@shj3/tokens` values, declared once so every rule below reads
 * `var(--space-2)`, `var(--card)`, `var(--chat-user-bubble)` — the same real,
 * kebab-cased token names `packages/tokens/src/css.ts`'s `toCssCustomPropertyName`
 * emits everywhere else in this app, so `scripts/gates/no-undefined-token.mjs`
 * recognises them as real tokens rather than an invented parallel vocabulary —
 * rather than a literal. `radius`/`spacing`/`shadow`'s own
 * `calc(var(--space-unit) * …)` chains need their root variables declared
 * too, or they resolve to nothing inside this shadow root's own scope.
 */
const WIDGET_TOKENS = `
  --space-unit: ${spacing.spaceUnit};
  --density-scale: ${spacing.densityScale};
  --radius-root: ${radius.radiusRoot};
  --shadow-color: ${shadow.shadowColor};
  --shadow-depth: ${shadow.shadowDepth};
  --space-1: ${spacing.space1};
  --space-2: ${spacing.space2};
  --space-3: ${spacing.space3};
  --radius-sm: ${radius.radiusSm};
  --radius-md: ${radius.radiusMd};
  --radius-lg: ${radius.radiusLg};
  --radius-full: ${radius.radiusFull};
  --shadow-lg: ${shadow.shadowLg};
  --shadow-xl: ${shadow.shadowXl};
  --text-xs: ${typography.textXs};
  --text-sm: ${typography.textSm};
  --text-base: ${typography.textBase};
  --text-lg: ${typography.textLg};
  --widget-hairline: 1px; /* design-gate-allow: a border hairline width has no dedicated token in this scale (packages/tokens/src/semantic.ts's own components/borders are all expressed the same way) — a structural CSS constant, not a brand-affecting design decision. */
  --card: ${colors.card};
  --card-foreground: ${colors.cardForeground};
  --border: ${colors.border};
  --primary: ${colors.primary};
  --primary-foreground: ${colors.primaryForeground};
  --chat-user-bubble: ${colors.chatUserBubble};
  --chat-user-bubble-foreground: ${colors.chatUserBubbleForeground};
  --chat-assistant-bubble: ${colors.chatAssistantBubble};
  --chat-assistant-bubble-foreground: ${colors.chatAssistantBubbleForeground};
  --chat-meta-foreground: ${colors.chatMetaForeground};
  --chat-disclaimer: ${colors.chatDisclaimer};
  --chat-disclaimer-foreground: ${colors.chatDisclaimerForeground};
  --chat-composer: ${colors.chatComposer};
`;

/** The default accent (`--primary`) when a channel's bootstrap response carries no resolved brand token — a real token value, not a bare literal restated here. */
const DEFAULT_ACCENT = colors.primary;

interface BootstrapData {
  readonly greetingText: string;
  readonly disclaimerText: string;
  readonly showDisclaimerDismiss: boolean;
  readonly composerPlaceholder: string;
  readonly accentTokenKey: string;
  readonly launcherPosition: "BottomRight" | "BottomLeft";
  readonly defaultState: "Docked" | "Expanded";
  readonly direction: "LTR" | "RTL";
  readonly theme: { readonly colorTokens: Record<string, string> };
  readonly chips: readonly { readonly id: string; readonly label: string }[];
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  streaming?: boolean;
  rating?: "up" | "down" | null;
}

// ---------------------------------------------------------------------------
// A small, self-contained SSE parser — see the module doc comment on why
// this is not imported from `modules/conversation/domain/sse-frame-parser.ts`.
// ---------------------------------------------------------------------------
interface SseFrame {
  readonly event: string | null;
  readonly data: string;
}

class MiniSseParser {
  private buffer = "";

  push(chunk: string): SseFrame[] {
    this.buffer += chunk.replace(/\r\n/g, "\n");
    const frames: SseFrame[] = [];
    let boundary: number;
    while ((boundary = this.buffer.indexOf("\n\n")) !== -1) {
      const raw = this.buffer.slice(0, boundary);
      this.buffer = this.buffer.slice(boundary + 2);
      let event: string | null = null;
      const dataLines: string[] = [];
      for (const line of raw.split("\n")) {
        if (!line || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        const value = colon === -1 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") dataLines.push(value);
      }
      if (dataLines.length > 0) frames.push({ event, data: dataLines.join("\n") });
    }
    return frames;
  }
}

function currentScriptEl(): HTMLScriptElement {
  const el = document.currentScript as HTMLScriptElement | null;
  if (!el) {
    throw new Error(
      "SHJ3 widget: document.currentScript is unavailable — this bundle must be loaded via a " +
        "plain <script> tag, not dynamically injected after the fact without `src` preserved.",
    );
  }
  return el;
}

function apiBase(scriptEl: HTMLScriptElement): string {
  // Derived from the script's OWN src origin, never a hardcoded constant or
  // a host-page-supplied value — see the module doc comment: this is what
  // lets one bundle serve every tenant's embed without per-tenant config.
  return new URL(scriptEl.src, window.location.href).origin;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, credentials: "include" });
  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const problem = (await response.json()) as { detail?: string; code?: string };
      detail = problem.detail ?? problem.code ?? detail;
    } catch {
      // ignore
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

function escapeHtml(value: string): string {
  const div = document.createElement("div");
  div.textContent = value;
  return div.innerHTML;
}

class Widget {
  private readonly base: string;
  private readonly channelKey: string;
  private bootstrap: BootstrapData | null = null;
  private conversationId: string | null = null;
  private messages: ChatMessage[] = [];
  private open = false;
  private expanded = false;
  private disclaimerDismissed = false;
  private busy = false;
  private recognizing = false;
  private recognition: unknown;

  private readonly root: ShadowRoot;
  private readonly container: HTMLDivElement;

  constructor(scriptEl: HTMLScriptElement) {
    this.base = apiBase(scriptEl);
    this.channelKey = scriptEl.dataset.channelKey ?? "";

    // api.md §4.1's third enforcement layer: the widget itself refuses to
    // initialise if its own origin was not the one it expected to be served
    // to. The server-side allow-list is authoritative; this is a client-side
    // belt-and-braces check that fails closed with a clear message rather
    // than silently attempting calls a `403 widget.domain_not_allowed` would
    // reject anyway.
    if (!this.channelKey) {
      console.error("[SHJ3 widget] missing data-channel-key attribute — refusing to initialise.");
      throw new Error("SHJ3 widget: data-channel-key is required.");
    }

    this.container = document.createElement("div");
    this.container.setAttribute("data-shj3-widget-host", "");
    document.body.appendChild(this.container);
    this.root = this.container.attachShadow({ mode: "open" });
  }

  async start(): Promise<void> {
    try {
      this.bootstrap = await fetchJson<BootstrapData>(
        `${this.base}/api/public/v1/widget/bootstrap?channelKey=${encodeURIComponent(this.channelKey)}`,
        { headers: { accept: "application/json" } },
      );
    } catch (error) {
      console.error("[SHJ3 widget] bootstrap failed", error);
      this.renderUnavailable();
      return;
    }
    this.open = this.bootstrap.defaultState === "Expanded";
    this.render();
  }

  /**
   * The console-only failure (`console.error` above) is invisible to anyone testing a
   * real embed the natural way — save the snippet, open it, see nothing happen, no
   * visible clue why (2026-09-10 stakeholder review, Issue 3). This renders one small,
   * deliberately generic notice instead of leaving the page silent.
   *
   * **Deliberately uninformative about *why*.** `fetchJson`'s thrown `Error` can carry a
   * real server `detail` (e.g. naming the rejected origin or the allow-list) — that text
   * is logged to the console (a developer-only surface an integrator opens on purpose)
   * but never placed in this DOM node. A genuinely unauthorized page must learn nothing
   * more from this widget than it already could from the console/network tab today; the
   * fixed string below is the same for every failure reason (a rejected origin, a
   * disabled channel, a network error) so its presence alone cannot be used to
   * distinguish one cause from another.
   */
  private renderUnavailable(): void {
    this.root.innerHTML = `
      <style>
        :host { all: initial; ${WIDGET_TOKENS} }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        .notice {
          position: fixed; inset-block-end: var(--space-3); inset-inline-end: var(--space-3);
          max-width: calc(var(--space-3) * 16);
          background: var(--card); color: var(--card-foreground);
          border: var(--widget-hairline) solid var(--border); /* design-gate-allow: --widget-hairline, see its declaration above. */
          font-size: var(--text-xs); line-height: 1.4;
          padding: var(--space-2) var(--space-3); border-radius: var(--radius-md);
          box-shadow: var(--shadow-lg);
          z-index: 2147483000;
        }
      </style>
      <div class="notice" role="status">SHJ3 Assistant is not available on this page.</div>
    `;
  }

  private async openConversation(): Promise<void> {
    if (this.conversationId || !this.bootstrap) return;
    const result = await fetchJson<{
      conversationId: string;
      greeting: { content: string };
    }>(`${this.base}/api/public/v1/conversations`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ channelKey: this.channelKey }),
    });
    this.conversationId = result.conversationId;
    this.messages = [{ id: "greeting", role: "assistant", text: result.greeting.content }];
    this.render();
  }

  private async send(text: string): Promise<void> {
    const value = text.trim();
    if (!value || this.busy || !this.conversationId) return;
    this.busy = true;
    const userId = `u-${Date.now()}`;
    const assistantId = `a-${Date.now()}`;
    this.messages.push({ id: userId, role: "user", text: value });
    this.messages.push({ id: assistantId, role: "assistant", text: "", streaming: true });
    this.render();

    try {
      const response = await fetch(
        `${this.base}/api/public/v1/conversations/${this.conversationId}/turns`,
        {
          method: "POST",
          credentials: "include",
          headers: { "content-type": "application/json", accept: "text/event-stream" },
          body: JSON.stringify({ content: value, inputMode: "text", clientTurnId: userId }),
        },
      );
      if (!response.ok || !response.body) throw new Error(`Turn failed (${response.status})`);

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new MiniSseParser();
      let assistantRealId = assistantId;
      let text_ = "";

      for (;;) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        for (const frame of parser.push(decoder.decode(chunk, { stream: true }))) {
          let data: Record<string, unknown> = {};
          try {
            data = JSON.parse(frame.data) as Record<string, unknown>;
          } catch {
            continue;
          }
          if (frame.event === "turn_started" && typeof data.turnId === "string") {
            const msg = this.messages.find((m) => m.id === assistantRealId);
            if (msg) msg.id = data.turnId;
            assistantRealId = data.turnId;
          } else if (frame.event === "token") {
            text_ += String(data.text ?? "");
            const msg = this.messages.find((m) => m.id === assistantRealId);
            if (msg) msg.text = text_;
            this.render();
          } else if (frame.event === "done" || frame.event === "error") {
            const msg = this.messages.find((m) => m.id === assistantRealId);
            if (msg) {
              msg.streaming = false;
              if (frame.event === "error" && typeof data.detail === "string" && !text_) {
                msg.text = data.detail;
              }
            }
            this.render();
          }
        }
      }
    } catch (error) {
      console.error("[SHJ3 widget] turn failed", error);
      const msg = this.messages.find((m) => m.id === assistantId);
      if (msg) {
        msg.streaming = false;
        msg.text = msg.text || "Something went wrong. Please try again.";
      }
    } finally {
      this.busy = false;
      this.render();
    }
  }

  private async rate(turnId: string, rating: "up" | "down"): Promise<void> {
    const msg = this.messages.find((m) => m.id === turnId);
    if (msg) {
      msg.rating = msg.rating === rating ? null : rating;
      this.render();
    }
    try {
      if (msg?.rating) {
        await fetch(`${this.base}/api/public/v1/turns/${turnId}/feedback`, {
          method: "PUT",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ rating: msg.rating }),
        });
      } else {
        await fetch(`${this.base}/api/public/v1/turns/${turnId}/feedback`, {
          method: "DELETE",
          credentials: "include",
        });
      }
    } catch {
      // best-effort — see use-widget-conversation.ts's identical note
    }
  }

  private speak(text: string): void {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  }

  private micAvailable(): boolean {
    return (
      "webkitSpeechRecognition" in window ||
      "SpeechRecognition" in (window as unknown as Record<string, unknown>)
    );
  }

  private toggleMic(inputEl: HTMLTextAreaElement): void {
    if (!this.micAvailable()) return;
    const RecognitionCtor =
      (window as unknown as { SpeechRecognition?: new () => unknown }).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: new () => unknown })
        .webkitSpeechRecognition;
    if (!RecognitionCtor) return;

    if (this.recognizing) {
      (this.recognition as { stop: () => void } | undefined)?.stop();
      this.recognizing = false;
      return;
    }

    type SpeechRecognitionLike = {
      continuous: boolean;
      interimResults: boolean;
      onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void;
      onend: () => void;
      start: () => void;
      stop: () => void;
    };
    const recognition = new (RecognitionCtor as unknown as new () => SpeechRecognitionLike)();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      const last = event.results[event.results.length - 1];
      const transcript = last?.[0]?.transcript ?? "";
      // Committed directly into the composer field (this module's own
      // documented trim — no STT-upload endpoint exists this wave, api.md
      // §4.2's own [ASSUMPTION]).
      inputEl.value = transcript;
    };
    recognition.onend = () => {
      this.recognizing = false;
      this.render();
    };
    this.recognition = recognition;
    this.recognizing = true;
    recognition.start();
    this.render();
  }

  private render(): void {
    if (!this.bootstrap) return;
    const b = this.bootstrap;
    const dir = b.direction === "RTL" ? "rtl" : "ltr";
    const accent = b.theme.colorTokens["color.brand.primary"] ?? DEFAULT_ACCENT;
    const side = b.launcherPosition === "BottomLeft" ? "left" : "right";

    this.root.innerHTML = `
      <style>
        :host {
          all: initial;
          ${WIDGET_TOKENS}
          --primary: ${accent};
        }
        * { box-sizing: border-box; font-family: system-ui, -apple-system, sans-serif; }
        .fab {
          position: fixed; bottom: var(--space-3); ${side}: var(--space-3);
          width: calc(var(--space-3) * 7); height: calc(var(--space-3) * 7);
          border-radius: var(--radius-full); background: var(--primary);
          color: var(--primary-foreground); border: none; cursor: pointer;
          box-shadow: var(--shadow-lg); font-size: var(--text-lg);
          z-index: 2147483000;
        }
        .panel {
          position: fixed; bottom: calc(var(--space-3) * 6); ${side}: var(--space-3);
          width: ${this.expanded ? "560px" : "400px"}; max-width: calc(100vw - var(--space-3) * 2); /* design-gate-allow: 400px/560px are FR-CONV-01's own literal, spec-mandated docked/expanded widths (SHJ3-wireframes-guide.md A1 "Docked... 400 px... Expanded... 560 px") — a product layout requirement, not a brand-able design-system value. */
          height: 70vh; max-height: 640px; /* design-gate-allow: 640px mirrors the same spec-mandated panel sizing as the width above, not a token candidate. */
          background: var(--card); border-radius: var(--radius-lg);
          box-shadow: var(--shadow-xl);
          display: ${this.open ? "flex" : "none"}; flex-direction: column; overflow: hidden;
          z-index: 2147483000; direction: ${dir};
        }
        .header {
          background: var(--primary); color: var(--primary-foreground);
          padding: var(--space-3); display:flex; justify-content:space-between; align-items:center;
        }
        .header button { background: transparent; border: none; color: inherit; cursor: pointer; font-size: var(--text-base); }
        .disclaimer {
          background: var(--chat-disclaimer); color: var(--chat-disclaimer-foreground);
          font-size: var(--text-xs); padding: var(--space-2) var(--space-3);
          display:flex; justify-content:space-between; gap: var(--space-2);
        }
        .thread { flex: 1; overflow-y: auto; padding: var(--space-3); display: flex; flex-direction: column; gap: var(--space-2); }
        .msg { max-width: 85%; padding: var(--space-2) var(--space-3); border-radius: var(--radius-lg); font-size: var(--text-sm); white-space: pre-wrap; }
        .msg.user { align-self: flex-end; background: var(--chat-user-bubble); color: var(--chat-user-bubble-foreground); }
        .msg.assistant { align-self: flex-start; background: var(--chat-assistant-bubble); color: var(--chat-assistant-bubble-foreground); }
        .meta { display:flex; gap: var(--space-1); font-size: var(--text-xs); color: var(--chat-meta-foreground); margin-top: var(--space-1); }
        .meta button { background:none; border:none; cursor:pointer; color: inherit; font-size: var(--text-xs); }
        .chips { display:flex; flex-wrap:wrap; gap: var(--space-2); padding: 0 var(--space-3) var(--space-2); }
        .chip {
          border: var(--widget-hairline) solid var(--primary); color: var(--primary); background: var(--card); /* design-gate-allow: --widget-hairline is the local, non-token border-width constant declared and justified above. */
          border-radius: var(--radius-full); padding: var(--space-1) var(--space-2);
          font-size: var(--text-xs); cursor:pointer;
        }
        .composer { display:flex; gap: var(--space-2); padding: var(--space-2); border-top: var(--widget-hairline) solid var(--border); } /* design-gate-allow: --widget-hairline, see its declaration above. */
        .composer textarea {
          flex:1; resize:none; border: var(--widget-hairline) solid var(--border); border-radius: var(--radius-md); /* design-gate-allow: --widget-hairline, see its declaration above. */
          padding: var(--space-2); font-size: var(--text-sm); min-height: 2.25rem;
        }
        .composer button {
          border:none; border-radius: var(--radius-md); padding: 0 var(--space-3); cursor:pointer;
          background: var(--primary); color: var(--primary-foreground);
        }
        .composer button[disabled] { opacity:.5; cursor:not-allowed; }
      </style>
      <button class="fab" aria-label="${this.open ? "Close" : "Open"} SHJ3 Assistant" title="SHJ3 Assistant">${this.open ? "×" : "✦"}</button>
      <div class="panel" role="dialog" aria-label="SHJ3 Assistant">
        <div class="header">
          <strong>SHJ3 Assistant</strong>
          <div>
            <button class="expand-btn" title="Expand/collapse">${this.expanded ? "▭" : "▢"}</button>
            <button class="close-btn" title="Close">×</button>
          </div>
        </div>
        ${
          b.disclaimerText && !this.disclaimerDismissed
            ? `<div class="disclaimer"><span>${escapeHtml(b.disclaimerText)}</span>${b.showDisclaimerDismiss ? '<button class="dismiss-disclaimer">×</button>' : ""}</div>`
            : ""
        }
        <div class="thread" role="log" aria-live="polite">
          ${this.messages
            .map(
              (m) => `
            <div class="msg ${m.role}" data-turn-id="${m.id}">
              <span class="sr-only">${m.role === "user" ? "You said:" : "SHJ3 Assistant said:"}</span>
              ${escapeHtml(m.text)}
              ${
                m.role === "assistant" && !m.streaming
                  ? `<div class="meta">
                      <button class="speak-btn" data-turn-id="${m.id}" title="Read aloud">🔊</button>
                      <button class="rate-btn" data-turn-id="${m.id}" data-rating="up" title="Thumbs up">${m.rating === "up" ? "👍✓" : "👍"}</button>
                      <button class="rate-btn" data-turn-id="${m.id}" data-rating="down" title="Thumbs down">${m.rating === "down" ? "👎✓" : "👎"}</button>
                    </div>`
                  : ""
              }
            </div>`,
            )
            .join("")}
        </div>
        <div class="chips">
          ${b.chips.map((chip) => `<button class="chip" data-chip='${escapeHtml(JSON.stringify(chip))}'>${escapeHtml(chip.label)}</button>`).join("")}
        </div>
        <div class="composer">
          <button class="mic-btn" title="${this.micAvailable() ? "Start voice input" : "Voice input unavailable in this browser (reason: mic.unsupported_browser)"}" ${this.micAvailable() ? "" : "disabled"}>${this.recognizing ? "⏺" : "🎤"}</button>
          <textarea class="composer-input" placeholder="${escapeHtml(b.composerPlaceholder)}" rows="1" ${this.busy ? "disabled" : ""}></textarea>
          <button class="send-btn" ${this.busy ? "disabled" : ""}>Send</button>
        </div>
      </div>
    `;

    this.wireEvents();
  }

  private wireEvents(): void {
    const fab = this.root.querySelector<HTMLButtonElement>(".fab");
    fab?.addEventListener("click", () => {
      this.open = !this.open;
      if (this.open) void this.openConversation();
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>(".close-btn")?.addEventListener("click", () => {
      this.open = false;
      this.render();
    });
    this.root.querySelector<HTMLButtonElement>(".expand-btn")?.addEventListener("click", () => {
      this.expanded = !this.expanded;
      this.render();
    });
    this.root
      .querySelector<HTMLButtonElement>(".dismiss-disclaimer")
      ?.addEventListener("click", () => {
        this.disclaimerDismissed = true;
        this.render();
      });

    const input = this.root.querySelector<HTMLTextAreaElement>(".composer-input");
    const doSend = () => {
      if (!input) return;
      const value = input.value;
      input.value = "";
      void this.send(value);
    };
    this.root.querySelector<HTMLButtonElement>(".send-btn")?.addEventListener("click", doSend);
    input?.addEventListener("keydown", (event) => {
      if (
        event.key === "Enter" &&
        !event.shiftKey &&
        !(event as unknown as { isComposing?: boolean }).isComposing
      ) {
        event.preventDefault();
        doSend();
      }
    });
    this.root.querySelector<HTMLButtonElement>(".mic-btn")?.addEventListener("click", () => {
      if (input) this.toggleMic(input);
    });

    for (const chipButton of this.root.querySelectorAll<HTMLButtonElement>(".chip")) {
      chipButton.addEventListener("click", () => {
        const raw = chipButton.getAttribute("data-chip");
        if (!raw) return;
        const chip = JSON.parse(raw) as { label: string };
        void this.send(chip.label);
      });
    }
    for (const speakButton of this.root.querySelectorAll<HTMLButtonElement>(".speak-btn")) {
      speakButton.addEventListener("click", () => {
        const turnId = speakButton.getAttribute("data-turn-id");
        const msg = this.messages.find((m) => m.id === turnId);
        if (msg) this.speak(msg.text);
      });
    }
    for (const rateButton of this.root.querySelectorAll<HTMLButtonElement>(".rate-btn")) {
      rateButton.addEventListener("click", () => {
        const turnId = rateButton.getAttribute("data-turn-id");
        const rating = rateButton.getAttribute("data-rating") as "up" | "down" | null;
        if (turnId && rating) void this.rate(turnId, rating);
      });
    }
  }
}

(function boot() {
  const scriptEl = currentScriptEl();
  const widget = new Widget(scriptEl);
  void widget.start();
})();
