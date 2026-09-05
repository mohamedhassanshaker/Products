import type { TenantBranding, WebWidgetConfig } from "@nextbot/contracts";

/**
 * FR-ADM-07: "the brand profile supplies the *default* values for the embed config's
 * `theme.*` fields... absent an override the widget inherits the tenant brand profile
 * automatically (no separate configuration step)." Precedence (low to high):
 * hardcoded widget defaults (applied client-side, Phase 8) < tenant `branding_config`
 * (this function) < the channel's own stored `config.theme` (an admin explicitly set
 * a channel-level theme value, which takes priority over the tenant-wide default) <
 * a host page's own `NextBot.init({ theme: {...} })` call (a genuine per-embed
 * override for a multi-brand tenant, applied entirely client-side in Phase 8 — this
 * server-side merge never sees it, by design, since it isn't part of
 * `CreateWidgetSessionRequest`).
 */
export function mergeWidgetConfigWithBranding(
  channelConfig: WebWidgetConfig,
  branding: TenantBranding | null,
): WebWidgetConfig {
  if (!branding) return channelConfig;

  return {
    ...channelConfig,
    theme: {
      primaryColor: channelConfig.theme?.primaryColor ?? branding.primaryColor,
      fontFamily: channelConfig.theme?.fontFamily ?? branding.fontFamily ?? undefined,
      launcherIcon: channelConfig.theme?.launcherIcon ?? branding.logoLightUrl ?? undefined,
      headerTitle: channelConfig.theme?.headerTitle,
      headerTitleAr: channelConfig.theme?.headerTitleAr,
    },
  };
}
