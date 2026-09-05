import type { MessageContentTypeValue, MessagePayload, MessageSenderValue, WebWidgetConfig } from "@nextbot/contracts";

/** Delivery state for a customer-sent message (`docs/design/UX_GUIDELINES.md` §5.3.1
 * — a web-session-appropriate tick model, distinct from the WhatsApp-style
 * sent/delivered/read language the spec's generic wording is closer to). */
export type DeliveryTick = "sending" | "sent" | "failed" | "queued" | "dropped";

export interface WidgetMessage {
  id: string;
  sequence: number;
  sender: MessageSenderValue;
  contentType: MessageContentTypeValue;
  payload: MessagePayload;
  createdAt: string;
  /** Only meaningful for `sender === "Customer"` messages. */
  tick?: DeliveryTick;
  /** Client-generated id used for offline-queue dedup + this message's own React key
   * before the server assigns a real id. */
  clientMessageId?: string;
}

/** The full `NextBot.init({...})` config the loader passes through (screen inventory
 * A.3.1) — validated/typed loosely here since the loader already did the fail-closed
 * `tenantId`/`channelId` check; this is what's left for the widget app to consume. */
export interface WidgetEmbedConfig {
  tenantId: string;
  channelId: string;
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
  language?: string;
  direction?: "auto" | "ltr" | "rtl";
  theme?: WebWidgetConfig["theme"];
  quickActions?: WebWidgetConfig["quickActions"];
  menu?: WebWidgetConfig["menu"];
  /**
   * Phase 6 (client-feedback-batch item 9) — Admin Console "test in sandbox before
   * promoting" preview mode ONLY. Never set by a real customer embed
   * (`NextBot.init({...})`'s documented public config never includes these two
   * fields) — they exist solely so `apps/web`'s `ChatPreviewPanel` can iframe this
   * same real widget bundle with a version override. `store.ts`'s `bootstrap()`
   * forwards both straight through to `createWidgetSession`, which is where the
   * *actual* authorization check happens (`apps/gateway`'s session route,
   * server-side, via `@nextbot/iam`'s `verifySandboxPreviewToken`) — this file has no
   * ability to enforce anything itself, it only carries the values through.
   */
  previewVersionId?: string;
  /** The signed, short-lived proof pairing with `previewVersionId` above — see its doc. */
  previewToken?: string;
}

export const MAX_OFFLINE_QUEUE = 20;
