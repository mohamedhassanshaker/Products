import { randomBytes } from "node:crypto";

/**
 * Generates the opaque, URL-safe `channelId` value a tenant pastes into their
 * `NextBot.init({ channelId: "..." })` embed snippet (LLD §3.4 `channel.public_key`,
 * screen inventory A.3.1). Deliberately not the channel's internal UUID — a public
 * key is meant to be safe to publish in client-side HTML source, and rotating it
 * (not built this phase) must not require changing the internal id anything else
 * references.
 */
export function generateChannelPublicKey(): string {
  return `wc_${randomBytes(16).toString("hex")}`;
}
