"use server";

/**
 * Server Actions for `/channels` (B10: Channel configurations) — every write on this screen.
 *
 * ## Permission gating
 *
 * `agents:manage` for every configuration write (matching `tools/actions.ts`'s own precedent:
 * there is no `channels:*` permission key in `modules/iam/domain/permissions.ts`, and api.md
 * §6.9's own prose uses dotted notation as prose only — the real, code-enforced constants are
 * colon-form). `agents:publish` is used for exactly the two release actions api.md's own
 * table names: approving/rejecting a WhatsApp template (§6.9: "requires `agents.publish`
 * because it releases outbound messaging capability") and sending a campaign right now
 * (§6.9/§10.3: "pushing an unsolicited message to thousands of citizens is a release
 * action"). Every other write — including enabling/disabling a campaign, which only ARMS a
 * trigger rather than firing it — stays on `agents:manage`, matching api.md's own table
 * exactly.
 *
 * Checked here, in the caller, per api.md §12 invariant 2 — the use cases in
 * `modules/channels/application` do not check permissions themselves.
 */
import { randomUUID } from "node:crypto";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { AddWidgetAllowedDomain } from "../../../../modules/channels/application/add-widget-allowed-domain.js";
import { ApproveMessageTemplate } from "../../../../modules/channels/application/approve-message-template.js";
import { CreateCampaign } from "../../../../modules/channels/application/create-campaign.js";
import { DisableCampaign } from "../../../../modules/channels/application/disable-campaign.js";
import {
  EnableCampaign,
  type EnableCampaignResult,
} from "../../../../modules/channels/application/enable-campaign.js";
import { RejectMessageTemplate } from "../../../../modules/channels/application/reject-message-template.js";
import {
  RemoveWidgetAllowedDomain,
  type RemoveWidgetAllowedDomainResult,
} from "../../../../modules/channels/application/remove-widget-allowed-domain.js";
import {
  SendCampaignNow,
  type SendCampaignNowResult,
} from "../../../../modules/channels/application/send-campaign-now.js";
import { SetFallbackLocale } from "../../../../modules/channels/application/set-fallback-locale.js";
import {
  SubmitMessageTemplate,
  type SubmitMessageTemplateResult,
} from "../../../../modules/channels/application/submit-message-template.js";
import { UpdateCampaign } from "../../../../modules/channels/application/update-campaign.js";
import {
  UpdateChannel,
  type UpdateChannelResult,
} from "../../../../modules/channels/application/update-channel.js";
import {
  UpdateHandoverHours,
  type UpdateHandoverHoursResult,
} from "../../../../modules/channels/application/update-handover-hours.js";
import {
  UpdateLocale,
  type UpdateLocaleResult,
} from "../../../../modules/channels/application/update-locale.js";
import { UpdateQuietHours } from "../../../../modules/channels/application/update-quiet-hours.js";
import {
  ConnectWhatsApp,
  type ConnectWhatsAppResult,
} from "../../../../modules/channels/application/connect-whatsapp.js";
import { UpdateWhatsAppConfig } from "../../../../modules/channels/application/update-whatsapp-config.js";
import {
  UpdateWidgetConfig,
  type UpdateWidgetConfigResult,
} from "../../../../modules/channels/application/update-widget-config.js";
import type {
  CampaignTrigger,
  ChannelState,
  LauncherPosition,
  WidgetDefaultState,
} from "../../../../modules/channels/domain/vocabulary.js";
import type { TimeOfDay } from "../../../../modules/channels/domain/quiet-hours.js";
import {
  campaignRepository,
  channelRepository,
  consentRepository,
  handoverConfigRepository,
  localeRepository,
  messageTemplateRepository,
  now,
  quietHoursRepository,
  whatsAppConfigRepository,
  widgetConfigRepository,
  workingHoursRepository,
} from "./composition.js";

const MANAGE_PERMISSION = "agents:manage" as const;
const PUBLISH_PERMISSION = "agents:publish" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Tab 1 — Channels
// ---------------------------------------------------------------------------

export interface UpdateChannelActionInput {
  readonly id: string;
  readonly state: ChannelState;
  readonly boundAgentId: string | null;
}

export async function updateChannelAction(
  input: UpdateChannelActionInput,
): Promise<ActionResult<UpdateChannelResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.updateChannel");
        const result = await new UpdateChannel({ channels: channelRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface UpdateHandoverHoursActionInput {
  readonly workingHoursProfileId: string;
  readonly handoverConfigId: string;
  readonly timezone: string;
  readonly publicHolidayAutoSync: boolean;
  readonly assistantAvailable247: boolean;
  readonly slots: readonly {
    readonly dayOfWeek: number;
    readonly opensAt: TimeOfDay;
    readonly closesAt: TimeOfDay;
  }[];
  readonly offerEscalationOutsideHours: boolean;
  readonly noAgentAvailableMessage: string;
}

export async function updateHandoverHoursAction(
  input: UpdateHandoverHoursActionInput,
): Promise<ActionResult<UpdateHandoverHoursResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.updateHandoverHours");
        const result = await new UpdateHandoverHours({
          workingHours: workingHoursRepository(),
          handover: handoverConfigRepository(),
        }).execute({ ...input, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 2 — Web widget studio
// ---------------------------------------------------------------------------

export interface UpdateWidgetConfigActionInput {
  readonly channelId: string;
  readonly accentTokenKey: string;
  readonly launcherPosition: LauncherPosition;
  readonly defaultState: WidgetDefaultState;
  readonly disclaimerText: string;
  readonly greetingText: string;
  readonly composerPlaceholder: string;
  readonly showDisclaimerDismiss: boolean;
  readonly tenantSlug: string;
  readonly scriptOrigin: string;
}

export async function updateWidgetConfigAction(
  input: UpdateWidgetConfigActionInput,
): Promise<ActionResult<UpdateWidgetConfigResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.updateWidgetConfig");
        const result = await new UpdateWidgetConfig({
          widgetConfig: widgetConfigRepository(),
        }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function addWidgetAllowedDomainAction(input: {
  readonly channelId: string;
  readonly domain: string;
}): Promise<ActionResult<{ readonly ok: true } | { readonly ok: false; readonly reason: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.addWidgetAllowedDomain");
        const result = await new AddWidgetAllowedDomain({
          widgetConfig: widgetConfigRepository(),
        }).execute({
          channelId: input.channelId,
          domain: input.domain,
          addedByStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function removeWidgetAllowedDomainAction(input: {
  readonly channelId: string;
  readonly domain: string;
}): Promise<ActionResult<RemoveWidgetAllowedDomainResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.removeWidgetAllowedDomain");
        const result = await new RemoveWidgetAllowedDomain({
          widgetConfig: widgetConfigRepository(),
          channels: channelRepository(),
        }).execute(input);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 3 — WhatsApp
// ---------------------------------------------------------------------------

export interface ConnectWhatsAppActionInput {
  readonly channelId: string;
  readonly phoneNumber: string;
  readonly phoneNumberId: string;
  readonly wabaId: string;
  readonly optInRequired: boolean;
  readonly credentialSecretRef: string;
  readonly webhookVerifySecretRef: string;
}

/** The real "Connect WhatsApp" onboarding action — see `ConnectWhatsApp`'s own doc comment.
 *  `agents:manage`, matching every other configuration write on this screen: connecting a
 *  channel is admin configuration, not a release action (`agents:publish` is reserved for
 *  the two real release actions this file's own module comment names — approving/rejecting a
 *  template and sending a campaign now). */
export async function connectWhatsAppAction(
  input: ConnectWhatsAppActionInput,
): Promise<ActionResult<ConnectWhatsAppResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.connectWhatsApp");
        const result = await new ConnectWhatsApp({
          whatsAppConfig: whatsAppConfigRepository(),
        }).execute({ ...input, now: now() });
        return { ok: true, value: result } as const;
      },
      // Never logs the two secret *references* as secrets — they are references, never
      // secret values (architecture §10, `CreateWhatsAppConfigInput`'s own doc comment).
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updateWhatsAppConfigAction(input: {
  readonly channelId: string;
  readonly phoneNumber: string;
  readonly wabaId: string;
  readonly optInRequired: boolean;
}): Promise<ActionResult<{ readonly ok: true }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.updateWhatsAppConfig");
        await new UpdateWhatsAppConfig({ whatsAppConfig: whatsAppConfigRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { ok: true } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface SubmitMessageTemplateActionInput {
  readonly name: string;
  readonly channelKey: string;
  readonly category: string;
  readonly bodySample: string;
  readonly variables: readonly string[];
  readonly localeCode: string;
}

export async function submitMessageTemplateAction(
  input: SubmitMessageTemplateActionInput,
): Promise<ActionResult<SubmitMessageTemplateResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.submitMessageTemplate");
        const result = await new SubmitMessageTemplate({
          templates: messageTemplateRepository(),
        }).execute({
          ...input,
          submittedByStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function approveMessageTemplateAction(input: {
  readonly id: string;
  readonly bspTemplateId: string;
}): Promise<ActionResult<{ readonly ok: true }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PUBLISH_PERMISSION, "channels.approveMessageTemplate");
        await new ApproveMessageTemplate({ templates: messageTemplateRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { ok: true } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function rejectMessageTemplateAction(input: {
  readonly id: string;
  readonly reason: string;
}): Promise<ActionResult<{ readonly ok: true }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        // api.md §6.9's own table gates rejection on `agents.publish` too — the same
        // release-action reasoning as approval (both are a real BSP decision this screen
        // mirrors, per §10.1 rule 5's "don't build two").
        requirePermission(principal, PUBLISH_PERMISSION, "channels.rejectMessageTemplate");
        await new RejectMessageTemplate({ templates: messageTemplateRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { ok: true } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 4 — Proactive messaging (campaigns + quiet hours)
// ---------------------------------------------------------------------------

export interface CreateCampaignActionInput {
  readonly name: string;
  readonly messageTemplateId: string;
  readonly trigger: CampaignTrigger;
  readonly triggerOffsetHours: number | null;
  readonly audienceDefinitionJson: string;
  readonly audienceLabel: string;
  readonly respectQuietHours: boolean;
}

export async function createCampaignAction(
  input: CreateCampaignActionInput,
): Promise<ActionResult<{ readonly campaignId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.createCampaign");
        const result = await new CreateCampaign({ campaigns: campaignRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { campaignId: result.campaign.id } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface UpdateCampaignActionInput {
  readonly id: string;
  readonly trigger: CampaignTrigger;
  readonly triggerOffsetHours: number | null;
  readonly audienceDefinitionJson: string;
  readonly audienceLabel: string;
  readonly respectQuietHours: boolean;
}

export async function updateCampaignAction(
  input: UpdateCampaignActionInput,
): Promise<ActionResult<{ readonly ok: true }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.updateCampaign");
        await new UpdateCampaign({ campaigns: campaignRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { ok: true } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function enableCampaignAction(
  id: string,
): Promise<ActionResult<EnableCampaignResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.enableCampaign");
        const result = await new EnableCampaign({ campaigns: campaignRepository() }).execute({
          id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { id } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function disableCampaignAction(
  id: string,
): Promise<ActionResult<{ readonly ok: true }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.disableCampaign");
        await new DisableCampaign({ campaigns: campaignRepository() }).execute({ id, now: now() });
        return { ok: true, value: { ok: true } } as const;
      },
      { method: "POST", body: { id } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * `POST /channels/campaigns/{id}/send-now`. The audience is resolved here, at the Server
 * Action boundary, as every `ConsentState` currently `OptedIn` for the campaign's own
 * channel/`ProactiveMessaging` purpose — a real, working stand-in for
 * `Campaign.audienceDefinitionJson`'s own richer per-campaign segment query, which does not
 * exist as a query engine anywhere in this codebase yet (`SendCampaignNow`'s own doc comment
 * names this trim). Every recipient still passes through `SendCampaignNow`'s real per-
 * recipient opt-in re-check — this resolver only decides who is *candidate*, never who is
 * *sent to*.
 */
export async function sendCampaignNowAction(
  id: string,
): Promise<ActionResult<SendCampaignNowResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PUBLISH_PERMISSION, "channels.sendCampaignNow");
        const consent = consentRepository();
        const campaign = await campaignRepository().findById(id);
        const recipients = campaign
          ? await consent.listOptedIn(campaign.messageTemplateChannelKey, "ProactiveMessaging")
          : [];
        const result = await new SendCampaignNow({
          campaigns: campaignRepository(),
          consent,
          quietHours: quietHoursRepository(),
        }).execute({
          campaignId: id,
          recipients,
          triggerOccurrenceKey: `manual:${randomUUID()}`,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { id } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updateQuietHoursAction(input: {
  readonly isEnabled: boolean;
  readonly startsAt: TimeOfDay;
  readonly endsAt: TimeOfDay;
  readonly timezone: string;
}): Promise<ActionResult<{ readonly ok: true }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.updateQuietHours");
        await new UpdateQuietHours({ quietHours: quietHoursRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: { ok: true } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 5 — Localization
// ---------------------------------------------------------------------------

export async function updateLocaleAction(input: {
  readonly localeCode: string;
  readonly voiceName: string | null;
  readonly isEnabled: boolean;
}): Promise<ActionResult<UpdateLocaleResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.updateLocale");
        const result = await new UpdateLocale({ locales: localeRepository() }).execute({
          ...input,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function setFallbackLocaleAction(
  localeCode: string,
): Promise<ActionResult<{ readonly ok: true }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "channels.setFallbackLocale");
        await new SetFallbackLocale({ locales: localeRepository() }).execute({
          localeCode,
          now: now(),
        });
        return { ok: true, value: { ok: true } } as const;
      },
      { method: "POST", body: { localeCode } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
