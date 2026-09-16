/**
 * `GET /api/public/v1/widget/bootstrap?channelKey=...` (api.md §4.2) — the
 * config half of the response. Resolved *theme tokens* are a sibling feature
 * module (`modules/theming`) and are composed by the route handler, not
 * imported here — a feature module may not import a sibling feature
 * (`eslint.config.mjs`'s `boundaries/element-types`), so the app-layer route
 * handler is the one place both `GetWidgetBootstrap` and `theming`'s
 * `ResolveTheme` are legitimately combined.
 */

import type { PublicChannelKind } from "../domain/channel-key.js";
import type { QuickActionRepository } from "../ports/quick-action-repository.js";
import type { WidgetChannelRepository } from "../ports/widget-channel-repository.js";

export class ChannelNotFoundError extends Error {
  readonly code = "conversation.channel_not_found";
  readonly status = 404;
  constructor() {
    super("No channel matches this key.");
    this.name = "ChannelNotFoundError";
  }
}

export interface GetWidgetBootstrapResult {
  readonly channelId: string;
  readonly channelState: string;
  readonly greetingText: string;
  readonly disclaimerText: string;
  readonly showDisclaimerDismiss: boolean;
  readonly composerPlaceholder: string;
  readonly accentTokenKey: string;
  readonly launcherPosition: string;
  readonly defaultState: string;
  readonly chips: readonly { readonly id: string; readonly label: string }[];
  readonly allowedDomains: readonly string[];
}

export class GetWidgetBootstrap {
  constructor(
    private readonly deps: {
      readonly widgetChannels: WidgetChannelRepository;
      readonly quickActions: QuickActionRepository;
    },
  ) {}

  async execute(input: {
    readonly channelKind: PublicChannelKind;
    readonly localeCode: string;
  }): Promise<GetWidgetBootstrapResult> {
    const channel = await this.deps.widgetChannels.findChannelByKind(input.channelKind);
    if (!channel) throw new ChannelNotFoundError();

    const [widgetConfig, chips, allowedDomains] = await Promise.all([
      this.deps.widgetChannels.findWidgetConfig(channel.channelId),
      this.deps.quickActions.listForChannel(input.channelKind, input.localeCode),
      this.deps.widgetChannels.listAllowedDomains(channel.channelId),
    ]);

    return {
      channelId: channel.channelId,
      channelState: channel.state,
      greetingText: widgetConfig?.greetingText ?? "",
      disclaimerText: widgetConfig?.disclaimerText ?? "",
      showDisclaimerDismiss: widgetConfig?.showDisclaimerDismiss ?? true,
      composerPlaceholder: widgetConfig?.composerPlaceholder ?? "",
      accentTokenKey: widgetConfig?.accentTokenKey ?? "--brand-accent-1",
      launcherPosition: widgetConfig?.launcherPosition ?? "BottomRight",
      defaultState: widgetConfig?.defaultState ?? "Docked",
      chips: chips.map((chip) => ({ id: chip.id, label: chip.label })),
      allowedDomains,
    };
  }
}
