import { isValidWidgetAllowedDomain } from "../domain/widget-allowlist.js";
import type { ChannelsReason } from "../domain/errors.js";
import type {
  WidgetAllowedDomainRow,
  WidgetConfigRepository,
} from "../ports/widget-config-repository.js";

export interface AddWidgetAllowedDomainInput {
  readonly channelId: string;
  readonly domain: string;
  readonly addedByStaffUserId: string;
  readonly now: Date;
}

export type AddWidgetAllowedDomainResult =
  | { readonly ok: true; readonly domain: WidgetAllowedDomainRow }
  | { readonly ok: false; readonly reason: ChannelsReason };

/** `POST /channels/web-widget/allowed-domains` (B10 tab 2). "This list is a security
 *  control, not a preference — it is audited" (api.md §6.9): every add is attributed to the
 *  real signed-in staff user. */
export class AddWidgetAllowedDomain {
  constructor(private readonly deps: { readonly widgetConfig: WidgetConfigRepository }) {}

  async execute(input: AddWidgetAllowedDomainInput): Promise<AddWidgetAllowedDomainResult> {
    if (!isValidWidgetAllowedDomain(input.domain)) {
      return { ok: false, reason: "channels.domain_invalid" };
    }
    const domain = await this.deps.widgetConfig.addAllowedDomain({
      channelId: input.channelId,
      domain: input.domain.trim(),
      addedByStaffUserId: input.addedByStaffUserId,
      now: input.now,
    });
    return { ok: true, domain };
  }
}
