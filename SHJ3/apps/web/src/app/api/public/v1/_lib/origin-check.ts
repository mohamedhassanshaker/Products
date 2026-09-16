/**
 * The one call every route on this surface makes right after resolving a
 * tenant/channel (this module's own brief: "call it at the top of every
 * route handler after tenant resolution").
 *
 * Takes the whole `Request`, not just its `Origin` header, so this one place
 * can also supply `assertOriginAllowed`'s same-origin evidence (`Referer` +
 * this request's own origin) for the one real, live-browser-found case where
 * a legitimate first-party caller (`/{locale}/widget`'s own SSR demo page)
 * sends no `Origin` header at all.
 */

import { assertOriginAllowed } from "../../../../../modules/conversation/domain/origin-allowlist.js";
import type { PublicChannelKind } from "../../../../../modules/conversation/domain/channel-key.js";
import { widgetChannelRepository } from "./composition.js";

export class ChannelKindNotFoundError extends Error {
  readonly code = "conversation.channel_not_found";
  readonly status = 404;
  constructor() {
    super("No channel matches this key for the current tenant.");
    this.name = "ChannelKindNotFoundError";
  }
}

/** Resolves the tenant's real `WidgetAllowedDomain` rows for `channelKind` (must already be running inside a bound tenant context) and asserts `request`'s `Origin` (or, absent that, a same-origin `Referer`) is on that list — throws `OriginNotAllowedError` (403) or `ChannelKindNotFoundError` (404, no channel row at all for this tenant). */
export async function assertOriginAllowedForChannelKind(
  request: Request,
  channelKind: PublicChannelKind,
): Promise<void> {
  const channel = await widgetChannelRepository().findChannelByKind(channelKind);
  if (!channel) throw new ChannelKindNotFoundError();
  const allowedDomains = await widgetChannelRepository().listAllowedDomains(channel.channelId);
  assertOriginAllowed(request.headers.get("origin"), allowedDomains, {
    refererHeader: request.headers.get("referer"),
    requestOrigin: new URL(request.url).origin,
  });
}
