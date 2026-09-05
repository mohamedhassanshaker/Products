import { WidgetChannelInactiveError, WidgetChannelNotFoundError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { findChannelByPublicKey, type ChannelRow } from "../infrastructure/channel-repository.js";

/**
 * FR-OC-01: resolves and validates a `WebWidget` channel for anonymous session
 * creation. Deliberately fails closed with the *same* generic "Chat is temporarily
 * unavailable" wording for both "no such channel" and "channel is not WebWidget" (an
 * unresolvable channel must not let a caller distinguish "wrong public key" from
 * "right key, wrong channel type" — that would leak channel-type information to an
 * anonymous caller), while a channel that resolves but isn't `Active` gets the
 * distinct inactive error per LLD §5.3.
 *
 * @throws {WidgetChannelNotFoundError} no such channel (or it isn't a WebWidget channel).
 * @throws {WidgetChannelInactiveError} the channel exists but is `Inactive`/`Error`.
 */
export async function resolveWidgetChannel(ctx: TenantContext, publicKey: string): Promise<ChannelRow> {
  const channel = await findChannelByPublicKey(ctx, publicKey);
  if (!channel || channel.type !== "WebWidget") {
    throw new WidgetChannelNotFoundError();
  }
  if (channel.status !== "Active") {
    throw new WidgetChannelInactiveError();
  }
  return channel;
}
