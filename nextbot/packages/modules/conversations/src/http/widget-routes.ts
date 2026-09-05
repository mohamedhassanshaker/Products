import type {
  CreateWidgetSessionRequest,
  SendWidgetMessageRequest,
} from "@nextbot/contracts";
import { createWidgetSession, type VerifiedSandboxPreview } from "../application/create-widget-session.js";
import { sendWidgetMessage, type SendWidgetMessageDeps } from "../application/send-widget-message.js";
import { setWidgetTypingState } from "../application/set-widget-typing.js";
import { setWidgetLanguage } from "../application/set-widget-language.js";
import { replayMessagesSince, subscribeToConversation } from "../application/stream-widget-events.js";
import { verifyWidgetSessionToken, type WidgetSessionClaims } from "../application/widget-session-token.js";
import type { TenantContext } from "@nextbot/db";

/**
 * `http/` layer (LLD §2.2): plain functions `apps/gateway`'s Route Handlers call
 * into directly (no RBAC guard here — the widget surface is anonymous-session-authed,
 * not RBAC-gated; see `verifyWidgetSessionToken` for the equivalent fail-closed check).
 */

/**
 * @param verifiedPreview Phase 6: passed straight through to `createWidgetSession` —
 * only ever supplied by `apps/gateway`'s route handler after it has independently
 * verified (via `@nextbot/iam`'s `verifySandboxPreviewToken`, since this module has
 * no allowed dependency on `iam`) that `input.previewToken` is a genuine,
 * unexpired Admin Console authorization for `input.previewVersionId`.
 */
export async function handleCreateWidgetSession(input: CreateWidgetSessionRequest, verifiedPreview?: VerifiedSandboxPreview) {
  return createWidgetSession(input, verifiedPreview);
}

/** Verifies the bearer widget session token — the composition root
 * (`apps/gateway`) calls this first on every authenticated widget endpoint and
 * returns 401 if it throws, exactly like `apps/web`'s `requireApi` does for admin
 * session cookies. */
export async function handleVerifyWidgetSession(token: string): Promise<WidgetSessionClaims> {
  return verifyWidgetSessionToken(token);
}

export async function handleSendWidgetMessage(session: WidgetSessionClaims, input: SendWidgetMessageRequest, deps?: SendWidgetMessageDeps) {
  return sendWidgetMessage(session, input, deps);
}

export function handleSetWidgetTyping(session: WidgetSessionClaims, state: "start" | "stop"): void {
  setWidgetTypingState(session, state);
}

export async function handleSetWidgetLanguage(session: WidgetSessionClaims, language: string): Promise<void> {
  await setWidgetLanguage(session, language);
}

export async function handleReplaySince(session: WidgetSessionClaims, sinceSequence: number) {
  const ctx: TenantContext = { tenantId: session.tenantId, region: session.region, environment: session.environment };
  return replayMessagesSince(ctx, session.conversationId, sinceSequence);
}

export function handleSubscribe(session: WidgetSessionClaims, onEvent: Parameters<typeof subscribeToConversation>[1]): () => void {
  return subscribeToConversation(session.conversationId, onEvent);
}
