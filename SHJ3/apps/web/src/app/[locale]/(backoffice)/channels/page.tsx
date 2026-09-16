import { headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { isAllowed, PermissionDeniedError } from "../../../../modules/iam/domain/permissions.js";
import {
  GetHandoverHours,
  type HandoverHoursSnapshot,
} from "../../../../modules/channels/application/get-handover-hours.js";
import { GetLocaleCoverage } from "../../../../modules/channels/application/get-locale-coverage.js";
import { GetQuietHours } from "../../../../modules/channels/application/get-quiet-hours.js";
import {
  GetWhatsAppSettings,
  type WhatsAppSettingsSnapshot,
} from "../../../../modules/channels/application/get-whatsapp-settings.js";
import {
  GetWidgetStudio,
  type WidgetStudioSnapshot,
} from "../../../../modules/channels/application/get-widget-studio.js";
import { ListCampaigns } from "../../../../modules/channels/application/list-campaigns.js";
import { ListChannels } from "../../../../modules/channels/application/list-channels.js";
import { ListLocales } from "../../../../modules/channels/application/list-locales.js";
import type { ChannelRow } from "../../../../modules/channels/ports/channel-repository.js";
import type { CampaignRow } from "../../../../modules/channels/ports/campaign-repository.js";
import type { LocaleRow } from "../../../../modules/channels/ports/locale-repository.js";
import type { QuietHoursConfigRow } from "../../../../modules/channels/ports/quiet-hours-repository.js";
import {
  campaignRepository,
  channelRepository,
  handoverConfigRepository,
  listBindableAgents,
  localeRepository,
  messageTemplateRepository,
  quietHoursRepository,
  whatsAppConfigRepository,
  widgetConfigRepository,
  workingHoursRepository,
  type AgentOption,
} from "./composition.js";
import { ChannelsScreen } from "./channels-screen.js";
import {
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

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
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
      readonly canPublish: boolean;
    };

/**
 * The real, request-derived origin for the widget embed snippet's `<script src>` — used
 * only when `SHJ3_WIDGET_SCRIPT_ORIGIN` is genuinely unset. That env var exists for a real
 * production deployment behind a CDN, where the public asset domain differs from the
 * request's own Host (`.env.example`'s own comment on it); its *absence* used to fall back
 * to a hardcoded placeholder domain (`https://assistant.shj.ae`) that was never real
 * anywhere, including this dev environment — a reviewer's live screenshot of the snippet
 * showed exactly that fake domain baked into a value someone could actually copy-paste.
 *
 * Mirrors the sign-in wave's own `X-Forwarded-Proto` precedent (`next-request-context.ts`'s
 * `requestIsHttps`, `api/public/v1/conversations/route.ts`'s `requestWasHttps`): a
 * TLS-terminating proxy in front of any real deployment sets `X-Forwarded-Proto` and
 * `X-Forwarded-Host`; their absence here means a bare local `next dev` (correctly `http://`
 * and the plain `Host` header), not a proxy this app does not yet trust.
 */
async function resolveWidgetScriptOrigin(): Promise<string> {
  const configuredOrigin = process.env.SHJ3_WIDGET_SCRIPT_ORIGIN;
  if (configuredOrigin) return configuredOrigin;

  const headerStore = await headers();
  const forwardedHost = headerStore.get("x-forwarded-host");
  const host = forwardedHost ?? headerStore.get("host");
  if (!host) {
    throw new Error(
      "Cannot resolve the widget script origin: the request carries no Host header, and " +
        "SHJ3_WIDGET_SCRIPT_ORIGIN is unset. Set SHJ3_WIDGET_SCRIPT_ORIGIN explicitly for " +
        "any deployment where the request may not carry one.",
    );
  }
  const forwardedProto = headerStore.get("x-forwarded-proto");
  const protocol =
    forwardedProto?.split(",")[0]?.trim().toLowerCase() === "https" ? "https" : "http";
  return `${protocol}://${host}`;
}

/**
 * `/channels` (B10: Channel configurations) — 5 tabs: Channels, Web widget studio, WhatsApp,
 * Proactive messaging, Localization.
 *
 * Gated on `agents:manage`, matching every other estate-wide backoffice screen this wave's
 * precedent set (`tools/page.tsx`'s own reasoning): there is no `channels:*` permission key
 * in `modules/iam/domain/permissions.ts`.
 *
 * Every query runs inside `withStaffAuth`'s handler, never after it returns — identical
 * precedent to `tools/page.tsx`/`iam/page.tsx`: `getTenantDb()`/`getTenantCache()` resolve
 * from an ambient `TenantContext` that only exists for the duration of that callback.
 */
export default async function ChannelsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("channels");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "agents:manage", "channels.page (visibility)");
      } catch (error) {
        if (error instanceof PermissionDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const channels = channelRepository();
      const [
        channelsResult,
        handoverHours,
        campaignsResult,
        quietHours,
        localesResult,
        bindableAgents,
      ] = await Promise.all([
        new ListChannels({ channels }).execute(),
        new GetHandoverHours({
          workingHours: workingHoursRepository(),
          handover: handoverConfigRepository(),
        }).execute(),
        new ListCampaigns({ campaigns: campaignRepository() }).execute(),
        new GetQuietHours({ quietHours: quietHoursRepository() }).execute(),
        new ListLocales({ locales: localeRepository() }).execute(),
        listBindableAgents(),
      ]);

      const webWidgetChannel = channelsResult.rows.find((c) => c.key === "WebWidget") ?? null;
      const whatsAppChannel = channelsResult.rows.find((c) => c.key === "WhatsApp") ?? null;
      const scriptOrigin = webWidgetChannel ? await resolveWidgetScriptOrigin() : null;

      const [widgetStudio, whatsAppSettings] = await Promise.all([
        webWidgetChannel && scriptOrigin
          ? new GetWidgetStudio({ widgetConfig: widgetConfigRepository() }).execute({
              channelId: webWidgetChannel.id,
              tenantSlug: principal.tenant,
              scriptOrigin,
            })
          : Promise.resolve(null),
        whatsAppChannel
          ? new GetWhatsAppSettings({
              whatsAppConfig: whatsAppConfigRepository(),
              templates: messageTemplateRepository(),
            }).execute(whatsAppChannel.id)
          : Promise.resolve(null),
      ]);

      const coverageEntries = await Promise.all(
        localesResult.rows.map(async (locale) => {
          const summary = await new GetLocaleCoverage({ locales: localeRepository() }).execute(
            locale.localeCode,
          );
          return [
            locale.localeCode,
            { translated: summary.translated + summary.reviewed, total: summary.total },
          ] as const;
        }),
      );

      return {
        kind: "ok",
        channels: channelsResult.rows,
        handoverHours,
        widgetStudio,
        widgetChannelId: webWidgetChannel?.id ?? null,
        whatsAppSettings,
        whatsAppChannelId: whatsAppChannel?.id ?? null,
        campaigns: campaignsResult.rows,
        quietHours,
        locales: localesResult.rows,
        localeCoverage: Object.fromEntries(coverageEntries),
        bindableAgents,
        tenantSlug: principal.tenant,
        // `actions.ts`'s own module comment: approving/rejecting a template and sending
        // a campaign now both require `agents:publish` ("a release action"), stricter
        // than the `agents:manage` this whole page is gated on — found live, via a real
        // E2E run as an `agents:manage`-only principal, that the *controls* for those two
        // release actions rendered regardless, only to fail server-side with a real
        // permission-denied error on click. Fixed at the root, matching this app's own
        // established separation-of-duties convention elsewhere (`agents-screen.tsx`'s
        // Publish/Unpublish row actions: never rendered for a non-publisher, not merely
        // disabled) — computed once here, not re-derived per tab.
        canPublish: isAllowed(principal.permissions, "agents:publish"),
      } as const;
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      pageData = { kind: "unauthenticated" };
    } else {
      throw error;
    }
  }

  if (pageData.kind === "unauthenticated") {
    const tCommon = await getTranslations("common");
    return (
      <div className="flex flex-col gap-4">
        <SignInPrompt
          heading={t("pageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/channels`)}`}
          signInLabel={tCommon("signInCta")}
        />
      </div>
    );
  }

  if (pageData.kind === "forbidden") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("permissionDeniedHeading")}</h1>
        <p className="text-sm text-muted-foreground">{t("permissionDeniedBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
      <ChannelsScreen
        channels={pageData.channels}
        handoverHours={pageData.handoverHours}
        widgetStudio={pageData.widgetStudio}
        widgetChannelId={pageData.widgetChannelId}
        whatsAppSettings={pageData.whatsAppSettings}
        whatsAppChannelId={pageData.whatsAppChannelId}
        campaigns={pageData.campaigns}
        quietHours={pageData.quietHours}
        locales={pageData.locales}
        localeCoverage={pageData.localeCoverage}
        canPublish={pageData.canPublish}
        bindableAgents={pageData.bindableAgents}
        tenantSlug={pageData.tenantSlug}
        actions={{
          updateChannel: updateChannelAction,
          updateHandoverHours: updateHandoverHoursAction,
          updateWidgetConfig: updateWidgetConfigAction,
          addWidgetAllowedDomain: addWidgetAllowedDomainAction,
          removeWidgetAllowedDomain: removeWidgetAllowedDomainAction,
          connectWhatsApp: connectWhatsAppAction,
          updateWhatsAppConfig: updateWhatsAppConfigAction,
          submitMessageTemplate: submitMessageTemplateAction,
          approveMessageTemplate: approveMessageTemplateAction,
          rejectMessageTemplate: rejectMessageTemplateAction,
          createCampaign: createCampaignAction,
          updateCampaign: updateCampaignAction,
          enableCampaign: enableCampaignAction,
          disableCampaign: disableCampaignAction,
          sendCampaignNow: sendCampaignNowAction,
          updateQuietHours: updateQuietHoursAction,
          updateLocale: updateLocaleAction,
          setFallbackLocale: setFallbackLocaleAction,
        }}
      />
    </div>
  );
}
