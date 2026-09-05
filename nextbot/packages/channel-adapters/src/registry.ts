import type { ChannelAdapter } from "./port.js";
import { whatsAppAdapter } from "./whatsapp/adapter.js";

/**
 * `ChannelType -> ChannelAdapter` — "the only switch in the codebase" (LLD §8).
 * WhatsApp is the only channel this dispatch implements for real; every other Meta
 * type (Messenger/Instagram — the rest of BL-15) and the remaining channel types
 * (Voice/Email/Sms/Slack/Teams) are reserved, not-yet-implemented entries so a
 * caller gets a clear, typed "not implemented" outcome rather than an undefined
 * lookup. WebWidget is deliberately absent here too — it is served entirely by
 * `@nextbot/conversations`' existing SSE-based session flow (Phase 7-8), which
 * predates this registry and is out of scope to retrofit into it this dispatch.
 */
const ADAPTERS: Partial<Record<string, ChannelAdapter>> = {
  WhatsApp: whatsAppAdapter,
};

export class ChannelAdapterNotImplementedError extends Error {
  constructor(channelType: string) {
    super(`No channel adapter is implemented yet for channel type '${channelType}'.`);
    this.name = "ChannelAdapterNotImplementedError";
  }
}

export function getChannelAdapter(channelType: string): ChannelAdapter {
  const adapter = ADAPTERS[channelType];
  if (!adapter) throw new ChannelAdapterNotImplementedError(channelType);
  return adapter;
}
