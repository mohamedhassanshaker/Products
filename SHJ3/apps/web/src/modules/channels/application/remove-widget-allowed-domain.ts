import type { ChannelsReason } from "../domain/errors.js";
import type { ChannelRepository } from "../ports/channel-repository.js";
import type { WidgetConfigRepository } from "../ports/widget-config-repository.js";

export interface RemoveWidgetAllowedDomainInput {
  readonly channelId: string;
  readonly domain: string;
}

export type RemoveWidgetAllowedDomainResult =
  { readonly ok: true } | { readonly ok: false; readonly reason: ChannelsReason };

/** `DELETE /channels/web-widget/allowed-domains/{domain}` (B10 tab 2). "Removing the last
 *  one while the widget channel is Live → 422: an empty allow-list would either lock
 *  everyone out or, if implemented as 'no restriction', open the widget to any site." */
export class RemoveWidgetAllowedDomain {
  constructor(
    private readonly deps: {
      readonly widgetConfig: WidgetConfigRepository;
      readonly channels: ChannelRepository;
    },
  ) {}

  async execute(input: RemoveWidgetAllowedDomainInput): Promise<RemoveWidgetAllowedDomainResult> {
    const [channel, domains] = await Promise.all([
      this.deps.channels.findById(input.channelId),
      this.deps.widgetConfig.listAllowedDomains(input.channelId),
    ]);

    const isLastDomain = domains.length === 1 && domains[0]?.domain === input.domain;
    if (isLastDomain && channel?.state === "Live") {
      return { ok: false, reason: "channels.allowlist_empty_while_live" };
    }

    await this.deps.widgetConfig.removeAllowedDomain(input.channelId, input.domain);
    return { ok: true };
  }
}
