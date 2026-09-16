"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { HandoverHoursSnapshot } from "../../../../modules/channels/application/get-handover-hours.js";
import type { WhatsAppSettingsSnapshot } from "../../../../modules/channels/application/get-whatsapp-settings.js";
import type { WidgetStudioSnapshot } from "../../../../modules/channels/application/get-widget-studio.js";
import type { CampaignRow } from "../../../../modules/channels/ports/campaign-repository.js";
import type { ChannelRow } from "../../../../modules/channels/ports/channel-repository.js";
import type { LocaleRow } from "../../../../modules/channels/ports/locale-repository.js";
import type { QuietHoursConfigRow } from "../../../../modules/channels/ports/quiet-hours-repository.js";
import type { AgentOption } from "./composition.js";
import { ChannelsTab } from "./channels-tab.js";
import { WidgetStudioTab } from "./widget-studio-tab.js";
import { WhatsAppTab } from "./whatsapp-tab.js";
import { ConnectWhatsAppForm } from "./connect-whatsapp-form.js";
import { CampaignsTab } from "./campaigns-tab.js";
import { LocalizationTab } from "./localization-tab.js";
import type {
  addWidgetAllowedDomainAction,
  approveMessageTemplateAction,
  connectWhatsAppAction,
  createCampaignAction,
  disableCampaignAction,
  enableCampaignAction,
  rejectMessageTemplateAction,
  removeWidgetAllowedDomainAction,
  sendCampaignNowAction,
  setFallbackLocaleAction,
  submitMessageTemplateAction,
  updateCampaignAction,
  updateChannelAction,
  updateHandoverHoursAction,
  updateLocaleAction,
  updateQuietHoursAction,
  updateWhatsAppConfigAction,
  updateWidgetConfigAction,
} from "./actions.js";

export interface ChannelsScreenActions {
  readonly updateChannel: typeof updateChannelAction;
  readonly updateHandoverHours: typeof updateHandoverHoursAction;
  readonly updateWidgetConfig: typeof updateWidgetConfigAction;
  readonly addWidgetAllowedDomain: typeof addWidgetAllowedDomainAction;
  readonly removeWidgetAllowedDomain: typeof removeWidgetAllowedDomainAction;
  readonly connectWhatsApp: typeof connectWhatsAppAction;
  readonly updateWhatsAppConfig: typeof updateWhatsAppConfigAction;
  readonly submitMessageTemplate: typeof submitMessageTemplateAction;
  readonly approveMessageTemplate: typeof approveMessageTemplateAction;
  readonly rejectMessageTemplate: typeof rejectMessageTemplateAction;
  readonly createCampaign: typeof createCampaignAction;
  readonly updateCampaign: typeof updateCampaignAction;
  readonly enableCampaign: typeof enableCampaignAction;
  readonly disableCampaign: typeof disableCampaignAction;
  readonly sendCampaignNow: typeof sendCampaignNowAction;
  readonly updateQuietHours: typeof updateQuietHoursAction;
  readonly updateLocale: typeof updateLocaleAction;
  readonly setFallbackLocale: typeof setFallbackLocaleAction;
}

export interface ChannelsScreenProps {
  readonly channels: readonly ChannelRow[];
  readonly handoverHours: HandoverHoursSnapshot | null;
  readonly widgetStudio: WidgetStudioSnapshot | null;
  readonly widgetChannelId: string | null;
  readonly whatsAppSettings: WhatsAppSettingsSnapshot | null;
  readonly whatsAppChannelId: string | null;
  readonly campaigns: readonly CampaignRow[];
  readonly quietHours: QuietHoursConfigRow | null;
  readonly locales: readonly LocaleRow[];
  readonly localeCoverage: Readonly<
    Record<string, { readonly translated: number; readonly total: number }>
  >;
  readonly bindableAgents: readonly AgentOption[];
  readonly tenantSlug: string;
  /** `agents:publish` — gates the WhatsApp tab's Approve/Reject and the Campaigns tab's
   *  "Send now", both real release actions per `actions.ts`'s own module comment. Never
   *  rendered, not merely disabled, for a principal who lacks it — matching this app's
   *  established separation-of-duties convention. */
  readonly canPublish: boolean;
  readonly actions: ChannelsScreenActions;
}

/** B10's five tabs, URL-synced (`?tab=`) — matching `tools-screen.tsx`'s own established
 *  `SubTabBar` convention for deep-linkability. */
export function ChannelsScreen({
  channels,
  handoverHours,
  widgetStudio,
  widgetChannelId,
  whatsAppSettings,
  whatsAppChannelId,
  campaigns,
  quietHours,
  locales,
  localeCoverage,
  bindableAgents,
  tenantSlug,
  canPublish,
  actions,
}: ChannelsScreenProps): React.ReactElement {
  const t = useTranslations("channels");

  const tabs = React.useMemo(
    () => [
      { value: "channels", label: t("tabs.channels") },
      { value: "widget-studio", label: t("tabs.widgetStudio") },
      { value: "whatsapp", label: t("tabs.whatsapp") },
      { value: "campaigns", label: t("tabs.campaigns") },
      { value: "localization", label: t("tabs.localization") },
    ],
    [t],
  );

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      <SubTabBarPanel value="channels">
        <ChannelsTab
          rows={channels}
          handoverHours={handoverHours}
          bindableAgents={bindableAgents}
          actions={actions}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="widget-studio">
        {widgetStudio && widgetChannelId ? (
          <WidgetStudioTab
            channelId={widgetChannelId}
            studio={widgetStudio}
            tenantSlug={tenantSlug}
            actions={actions}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{t("widgetStudio.notProvisioned")}</p>
        )}
      </SubTabBarPanel>
      <SubTabBarPanel value="whatsapp">
        {whatsAppSettings && whatsAppChannelId ? (
          <WhatsAppTab
            channelId={whatsAppChannelId}
            settings={whatsAppSettings}
            canPublish={canPublish}
            actions={actions}
          />
        ) : whatsAppChannelId ? (
          // A real `Channel` row exists (every tenant gets one now —
          // `ProvisionDefaultChannelsForTenant`) but no `WhatsAppConfig` row yet: the real
          // "Connect WhatsApp" onboarding path, not a dead end.
          <ConnectWhatsAppForm
            channelId={whatsAppChannelId}
            connectWhatsApp={actions.connectWhatsApp}
          />
        ) : (
          // No `Channel` row at all — should not happen for any tenant provisioned after
          // the channel-provisioning fix, kept as an honest fallback rather than assumed
          // unreachable.
          <p className="text-sm text-muted-foreground">{t("whatsapp.notProvisioned")}</p>
        )}
      </SubTabBarPanel>
      <SubTabBarPanel value="campaigns">
        <CampaignsTab
          rows={campaigns}
          quietHours={quietHours}
          canPublish={canPublish}
          actions={actions}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="localization">
        <LocalizationTab rows={locales} coverage={localeCoverage} actions={actions} />
      </SubTabBarPanel>
    </SubTabBar>
  );
}
