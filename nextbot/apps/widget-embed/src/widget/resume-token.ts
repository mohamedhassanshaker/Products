import type { WidgetEmbedConfig } from "./types.js";

/**
 * D12 (QA fix pass): client-side persistence for the widget's session-resumption
 * token. The Phase-7 backend has always supported `resumeSessionToken` on
 * `CreateWidgetSessionRequest` (`createWidgetSession`'s `tryResumeConversation`),
 * but nothing on the frontend ever read or wrote it — every reopen (page reload,
 * re-minimize/re-open) started a brand-new anonymous conversation and lost the
 * prior one, even though the backend was fully able to resume it.
 *
 * The "resume token" *is* the previously-issued `sessionToken` itself — the
 * backend's `tryResumeConversation` verifies it and looks up the conversation it
 * names, so persisting and replaying that same token is the entire client-side
 * mechanism. Scoped per tenant+channel (`localStorage`, keyed so multiple distinct
 * embeds on the same host page/origin never collide or resume each other's
 * conversation) and deliberately never a hard dependency: any storage failure
 * (disabled/full/private-browsing) or an expired/invalid token is handled by
 * simply not resuming — `createWidgetSession`'s own fallback already starts a
 * fresh conversation in that case (D12 explicitly only requires *not losing* a
 * resumable conversation, not full "Welcome back, [Name]" personalization).
 */

const STORAGE_KEY_PREFIX = "nextbot-widget:resume-token:";

function storageKey(config: Pick<WidgetEmbedConfig, "tenantId" | "channelId">): string {
  return `${STORAGE_KEY_PREFIX}${config.tenantId}:${config.channelId}`;
}

/** Reads a previously-saved resume token for this tenant+channel, if any. Never
 * throws — a storage-access error (private-browsing Safari, storage disabled by
 * the host page's policy, etc.) is treated the same as "no token saved". */
export function loadResumeToken(config: Pick<WidgetEmbedConfig, "tenantId" | "channelId">): string | undefined {
  try {
    return window.localStorage.getItem(storageKey(config)) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Persists the session token returned by every successful `bootstrap()` call (new
 * or resumed) so the *next* reopen can attempt to resume from it. Never throws. */
export function saveResumeToken(config: Pick<WidgetEmbedConfig, "tenantId" | "channelId">, token: string): void {
  try {
    window.localStorage.setItem(storageKey(config), token);
  } catch {
    // Resumption is a nice-to-have continuity feature, never a hard requirement —
    // failing silently here just means the next reopen starts fresh instead.
  }
}
