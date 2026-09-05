import { create } from "zustand";
import type { MessageContentTypeValue, MessageDto, MessagePayload, WebWidgetTheme } from "@nextbot/contracts";
import { createWidgetSession, openWidgetStream, sendWidgetMessage, setWidgetLanguage, WidgetApiError } from "./api.js";
import { MAX_OFFLINE_QUEUE, type WidgetEmbedConfig, type WidgetMessage } from "./types.js";
import { loadResumeToken, saveResumeToken } from "./resume-token.js";

export type WidgetView = "launcher" | "window";
export type WidgetScreen = "welcome" | "conversation";
export type InitErrorKind = "not-found" | "inactive" | null;

interface QueuedSend {
  clientMessageId: string;
  contentType: MessageContentTypeValue;
  payload: MessagePayload;
}

interface WidgetStoreState {
  config: WidgetEmbedConfig | null;
  view: WidgetView;
  screen: WidgetScreen;
  languageModalOpen: boolean;
  language: string;
  sessionToken: string | null;
  conversationId: string | null;
  messages: WidgetMessage[];
  offlineQueue: QueuedSend[];
  isOnline: boolean;
  aiTyping: boolean;
  unreadCount: number;
  bootstrapping: boolean;
  initError: InitErrorKind;
  queueDropNoticeShown: boolean;
  hidePoweredBy: boolean;
  /** D4 fix (QA fix pass): the tenant's brand theme as resolved server-side
   * (`channel.config.theme` — already merged with `branding_config` by
   * `mergeWidgetConfigWithBranding`) from the most recent `bootstrap()`. This is
   * the *default* theme; a per-embed `NextBot.init({ theme: {...} })` override
   * (this widget's own `config.theme`, decoded from the URL) still takes final
   * precedence over it wherever both specify the same field — see `WidgetApp.tsx`'s
   * theme computation. */
  channelTheme: WebWidgetTheme | null;
  /** Phase 16 (BL-09), A.2.11 — non-null exactly while the conversation is waiting
   * for a human agent to claim it (the "Please hold on…" wait indicator). Cleared
   * (`null`) once a `conversation` event reports any status other than `Escalated`
   * (claimed, returned to bot, or resolved) — the actual "Agent joined"/"returning to
   * AI" text is delivered as its own ordinary System `message`, not through this field. */
  escalationWait: { queueName: string; positionEstimate?: number } | null;

  bootstrap: (config: WidgetEmbedConfig) => Promise<void>;
  openWindow: () => void;
  minimizeWindow: () => void;
  openLanguageModal: () => void;
  closeLanguageModal: () => void;
  selectLanguage: (language: string) => Promise<void>;
  send: (contentType: MessageContentTypeValue, payload: MessagePayload) => Promise<void>;
  setOnline: (online: boolean) => void;
  handleStreamEvent: (event: string, data: unknown) => void;
}

let streamHandle: EventSource | null = null;

function toWidgetMessage(dto: MessageDto): WidgetMessage {
  return {
    id: dto.id,
    sequence: dto.sequence,
    sender: dto.sender,
    contentType: dto.contentType,
    payload: dto.payload as MessagePayload,
    createdAt: dto.createdAt,
    // D6: carried through so `handleStreamEvent` can dedup/reconcile the
    // customer's own message against its optimistic local bubble by this key.
    clientMessageId: dto.clientMessageId,
  };
}

export const useWidgetStore = create<WidgetStoreState>((set, get) => ({
  config: null,
  view: "launcher",
  screen: "welcome",
  languageModalOpen: false,
  language: "en",
  sessionToken: null,
  conversationId: null,
  messages: [],
  offlineQueue: [],
  isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
  aiTyping: false,
  unreadCount: 0,
  bootstrapping: false,
  initError: null,
  queueDropNoticeShown: false,
  hidePoweredBy: false,
  channelTheme: null,
  escalationWait: null,

  async bootstrap(config) {
    set({ config, bootstrapping: true, initError: null });
    try {
      // D12: replay a prior session's resume token, if one was saved for this
      // exact tenant+channel — the backend (`createWidgetSession`'s
      // `tryResumeConversation`) silently falls back to a brand-new conversation
      // if it's missing, expired, or otherwise invalid, so there is no
      // "resume failed" error path to handle here.
      //
      // Phase 6: a sandbox-preview mount (`config.previewVersionId` set) never
      // resumes — every "Test in Sandbox" open and every "reload session" click in
      // `ChatPreviewPanel` is a deliberate fresh conversation against the version
      // under test, never a continuation of a previous test run (and never persists
      // a resume token either, for the same reason — see below).
      const resumeSessionToken = config.previewVersionId ? undefined : loadResumeToken(config);
      const result = await createWidgetSession({
        tenantSlug: config.tenantId,
        channelPublicKey: config.channelId,
        language: config.language,
        resumeSessionToken,
        previewVersionId: config.previewVersionId,
        previewToken: config.previewToken,
      });
      // Persist the (possibly brand-new) session token so the *next* reopen has
      // something to resume from, regardless of whether this bootstrap itself
      // resumed anything. Skipped entirely for a sandbox-preview mount (see above).
      if (!config.previewVersionId) saveResumeToken(config, result.sessionToken);
      set({
        sessionToken: result.sessionToken,
        conversationId: result.conversationId,
        language: result.channel.languages[0] ?? "en",
        hidePoweredBy: result.channel.hidePoweredBy,
        channelTheme: result.channel.config.theme ?? null,
        bootstrapping: false,
        // A successful resume (`resumeFromSequence > 0`) means there is prior
        // conversation history about to be replayed via the SSE gap-fill below —
        // show it immediately rather than the Welcome screen (D12).
        screen: result.resumeFromSequence > 0 ? "conversation" : "welcome",
      });
      // D12 fix (QA fix pass, retry 2): `bootstrap()` only ever runs against a
      // brand-new, empty in-memory store — whether this is a genuinely first-ever
      // session or a reload resuming a prior conversation, there are zero messages
      // loaded locally at this point. The gateway's `handleReplaySince` replays
      // every message with `sequence > sinceSequence`, so the correct "give me the
      // full history to populate this empty store" cursor is always 0, never
      // `result.resumeFromSequence` (the highest sequence *already in* the
      // conversation) — passing that instead matched nothing and left a resumed
      // conversation's history permanently blank. `result.resumeFromSequence` would
      // be the right cursor for a live in-tab SSE reconnect where the store already
      // holds messages up to that sequence, but no such code path calls
      // `connectStream` a second time here — `EventSource`'s native retry (see
      // `onerror` below) handles that case entirely inside the browser, and replays
      // are dedup-safe by `sequence` in `handleStreamEvent` regardless.
      connectStream(result.sessionToken, 0, get);
    } catch (err) {
      const status = err instanceof WidgetApiError ? err.status : 500;
      set({ bootstrapping: false, initError: status === 403 ? "inactive" : "not-found" });
    }
  },

  openWindow() {
    set({ view: "window", unreadCount: 0 });
  },

  minimizeWindow() {
    set({ view: "launcher" });
  },

  openLanguageModal() {
    set({ languageModalOpen: true });
  },

  closeLanguageModal() {
    set({ languageModalOpen: false });
  },

  async selectLanguage(language) {
    set({ language, languageModalOpen: false });
    const token = get().sessionToken;
    if (token) {
      try {
        await setWidgetLanguage(token, language);
      } catch {
        // FR-OC-07: a failed persistence call must never block the UI language
        // switch itself — the selection still applies client-side for this session.
      }
    }
  },

  async send(contentType, payload) {
    const clientMessageId = crypto.randomUUID();
    const online = get().isOnline;
    const optimistic: WidgetMessage = {
      id: clientMessageId,
      sequence: -1,
      sender: "Customer",
      contentType,
      payload,
      createdAt: new Date().toISOString(),
      tick: online ? "sending" : "queued",
      clientMessageId,
    };
    set((state) => ({ messages: [...state.messages, optimistic], screen: "conversation" }));

    if (!online) {
      enqueueOffline(clientMessageId, contentType, payload, set);
      return;
    }

    await dispatchSend(clientMessageId, contentType, payload, set, get);
  },

  setOnline(online) {
    const wasOffline = !get().isOnline;
    set({ isOnline: online });
    if (online && wasOffline) {
      void flushQueue(set, get);
    }
  },

  handleStreamEvent(event, data) {
    if (event === "message") {
      const { message } = data as { message: MessageDto };
      const incoming = toWidgetMessage(message);
      set((state) => {
        // Gap-replay/reconnect dedup: a sequence we already rendered is a no-op.
        if (state.messages.some((m) => m.sequence === incoming.sequence)) return state;

        if (incoming.sender === "Customer") {
          // D6 fix: the customer's own message can be reconciled from two
          // independent, racing sources — this SSE echo, and `dispatchSend`'s own
          // direct HTTP response. The echo can genuinely arrive *first* (before the
          // HTTP response that used to be this bubble's only reconciliation path),
          // at which point the bubble still only has its client-generated id, not
          // the server one — matching on `clientMessageId` (present on this DTO,
          // never on the AI reply) is the race-proof key; whichever source arrives
          // first reconciles the existing bubble in place, the other is then a
          // no-op against that same clientMessageId rather than a second bubble.
          const matchIndex = incoming.clientMessageId
            ? state.messages.findIndex((m) => m.clientMessageId === incoming.clientMessageId)
            : -1;
          if (matchIndex !== -1) {
            const messages = [...state.messages];
            const prior = messages[matchIndex]!;
            messages[matchIndex] = {
              ...prior,
              id: incoming.id,
              sequence: incoming.sequence,
              tick: prior.tick === "failed" ? prior.tick : "sent",
            };
            return { messages };
          }
          // No local optimistic bubble matched (e.g. a reconnect replaying a
          // message already rendered under its real server id) — fall through to
          // appending it, unless it's already present under that id.
          if (state.messages.some((m) => m.id === incoming.id)) return state;
        }

        return {
          messages: [...state.messages, incoming],
          aiTyping: false,
          unreadCount: state.view === "launcher" && incoming.sender === "AI" ? state.unreadCount + 1 : state.unreadCount,
        };
      });
    } else if (event === "typing") {
      const { actor, state: typingState } = data as { actor: "ai" | "human"; state: "start" | "stop" };
      if (actor === "ai") set({ aiTyping: typingState === "start" });
    } else if (event === "conversation") {
      // Phase 16 (BL-09), A.2.11: drives the wait indicator only — the actual
      // "Agent [Name] has joined"/"Returning to AI assistant" text arrives as its own
      // System `message` event (see `@nextbot/escalations`), not synthesized here.
      const { status, escalation } = data as { status: string; escalation?: { queueName: string; positionEstimate?: number } };
      set({ escalationWait: status === "Escalated" && escalation ? escalation : null });
    }
  },
}));

function connectStream(token: string, sinceSequence: number, get: () => WidgetStoreState): void {
  streamHandle?.close();
  const source = openWidgetStream(token, sinceSequence);
  streamHandle = source;
  source.addEventListener("message", (e: MessageEvent) => get().handleStreamEvent("message", JSON.parse(e.data)));
  source.addEventListener("typing", (e: MessageEvent) => get().handleStreamEvent("typing", JSON.parse(e.data)));
  source.addEventListener("conversation", (e: MessageEvent) => get().handleStreamEvent("conversation", JSON.parse(e.data)));
  source.onerror = () => {
    // EventSource auto-retries natively (LLD §5.3); connectivity state itself is
    // driven independently by `navigator.onLine`/`online`/`offline` listeners
    // (see WidgetApp.tsx), not by this handler.
  };
}

function enqueueOffline(
  clientMessageId: string,
  contentType: MessageContentTypeValue,
  payload: MessagePayload,
  set: (fn: (state: WidgetStoreState) => Partial<WidgetStoreState>) => void,
): void {
  set((state) => {
    let queue = [...state.offlineQueue, { clientMessageId, contentType, payload }];
    let queueDropNoticeShown = state.queueDropNoticeShown;
    let messages = state.messages;
    if (queue.length > MAX_OFFLINE_QUEUE) {
      // Non-null: guaranteed present since `queue.length > MAX_OFFLINE_QUEUE` (>= 1).
      const dropped = queue[0]!;
      queue = queue.slice(1);
      console.warn(`NextBot widget: offline queue full (${MAX_OFFLINE_QUEUE}) — dropped oldest queued message`, dropped);
      // D11 fix (QA fix pass): the dropped message's own bubble must visibly stop
      // reading as "still queued" — it will never be sent now that it's been
      // evicted from `offlineQueue`, but without this it looked identical to every
      // other still-pending queued bubble forever.
      messages = messages.map((m) => (m.clientMessageId === dropped.clientMessageId ? { ...m, tick: "dropped" as const } : m));
      // docs/design/UX_GUIDELINES.md §5.2.5: the spec only requires the console
      // warning, but a customer-facing, one-time notice closes a real UX gap — shown
      // once per session, not once per drop.
      if (!queueDropNoticeShown) {
        queueDropNoticeShown = true;
        messages = [
          ...messages,
          {
            id: crypto.randomUUID(),
            sequence: -1,
            sender: "System",
            contentType: "Text",
            payload: {
              contentType: "Text",
              text: "Some earlier messages couldn't be saved and were removed — you may want to resend them.",
            },
            createdAt: new Date().toISOString(),
          },
        ];
      }
    }
    return { offlineQueue: queue, queueDropNoticeShown, messages };
  });
}

async function dispatchSend(
  clientMessageId: string,
  contentType: MessageContentTypeValue,
  payload: MessagePayload,
  set: (fn: (state: WidgetStoreState) => Partial<WidgetStoreState>) => void,
  get: () => WidgetStoreState,
): Promise<void> {
  const token = get().sessionToken;
  if (!token) return;
  try {
    set(() => ({ aiTyping: true }));
    const result = await sendWidgetMessage(token, { clientMessageId, contentType, payload });
    // Reconcile the optimistic bubble directly from the HTTP response (no need to
    // wait for an SSE echo of the customer's own message).
    set((state) => ({
      messages: state.messages.map((m) =>
        m.clientMessageId === clientMessageId ? { ...m, id: result.messageId, sequence: result.sequence, tick: "sent" as const } : m,
      ),
    }));
  } catch {
    // D8 fix (QA fix pass): a client-detected send failure (network error, non-2xx
    // response — `sendWidgetMessage` throws for both) must render the widget's own
    // `ErrorBubble` component, not just flip the customer bubble's tick glyph to
    // "failed" with no other visible feedback. Reuses FR-AI-05's exact
    // `BackendTimeout` copy — a client-side failure to reach the backend at all is
    // that same failure class from the customer's point of view.
    set((state) => ({
      aiTyping: false,
      messages: [
        ...state.messages.map((m) => (m.clientMessageId === clientMessageId ? { ...m, tick: "failed" as const } : m)),
        {
          id: crypto.randomUUID(),
          sequence: -1,
          sender: "AI",
          contentType: "Error",
          payload: {
            contentType: "Error",
            reason: "BackendTimeout",
            text: "I'm having trouble reaching the system right now. Please try again in a moment, or I can connect you to an agent.",
          },
          createdAt: new Date().toISOString(),
        },
      ],
    }));
  }
}

async function flushQueue(
  set: (fn: (state: WidgetStoreState) => Partial<WidgetStoreState>) => void,
  get: () => WidgetStoreState,
): Promise<void> {
  const queue = get().offlineQueue;
  set(() => ({ offlineQueue: [] }));
  for (const item of queue) {
    await dispatchSend(item.clientMessageId, item.contentType, item.payload, set, get);
  }
}

/** Test-only: resets module-level SSE handle state between test files. */
export function _resetStreamHandleForTests(): void {
  streamHandle?.close();
  streamHandle = null;
}
