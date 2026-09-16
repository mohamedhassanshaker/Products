/**
 * Deterministic demo data for B10, transcribed from `docs/SHJ3-wireframes-guide.md`'s B10
 * tabs 1-5 sample rows. `scripts/seed-channels-demo-data.ts` is the composition root and CLI
 * entry point — call this under `runWithTenant({ tenant: sewa, ... })`, mirroring every other
 * module's own seed convention (`modules/tools/application/seed-demo-data.ts`'s doc comment
 * explains why: `getTenantDb()` resolves from the *ambient* bound tenant, so this function
 * assumes its caller has already bound it, and does not call `runWithTenant` itself).
 *
 * Unlike `tools`/`iam`, this file reaches `getTenantDb()`/`getPlatformDb()` directly rather
 * than through one of this module's own repository ports for most of what it seeds
 * (`WorkingHoursProfile`/`HandoverConfig`/`MessageTemplate`/`Campaign`/...) — those ports
 * assume the row already exists, and a one-time bootstrap script legitimately needs its own
 * direct creation path for data no port covers. That is also why this file lives here, in
 * `adapters/outbound/sql/`, rather than in `application/` alongside `tools`'/`iam`'s own
 * port-only seed files — this project's own architecture-boundary lint rule
 * (`no-restricted-imports`, architecture.md §4) correctly refuses an `application/` file that
 * reaches `getTenantDb()` directly, and this file's whole reason to exist is that direct
 * reach, not a violation to route around.
 *
 * `Channel` itself is the one exception, and it is worth naming precisely: real tenant
 * provisioning now creates B10 tab 1's fixed four-row catalogue for every tenant
 * (`ChannelRepository.createDefault`, `ProvisionDefaultChannelsForTenant`, wired into
 * `ProvisionTenant` — closing a real bug where only this demo-data file, hardcoded to
 * `sewa`, ever created a `Channel` row at all). This file still creates `sewa`'s own four
 * rows directly rather than calling that use case, because `sewa`'s demo data is not the
 * *default* shape (`WebWidget`/`WhatsApp` ship real config and `Live`, not `Disabled` with no
 * config) — reusing the default-provisioning path here would produce the wrong rows and then
 * require overwriting them, which is not simpler than seeding the real demo shape directly.
 */
import {
  getPlatformDb,
  getTenantDb,
} from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { toPrismaTime } from "./time-of-day.js";

export interface SeedChannelsDemoDataInput {
  /** The real, already-seeded "SEWA & Utilities Billing Agent" `Agent.id` (`scripts/seed-
   *  agents-tools-demo-data.ts`) — looked up by the caller so this file never hardcodes an
   *  id that could drift between environments. */
  readonly boundAgentId: string;
  /** The real, already-seeded "SEWA Billing" `Team.id` (`scripts/seed-iam-demo-data.ts`),
   *  referenced by `HandoverConfig.defaultQueueTeamId` — a B7/B8 escalation-queue concern
   *  this module reads but does not own. */
  readonly defaultQueueTeamId: string;
  readonly now: Date;
}

/** B10 tab 1's four channels, `WorkingHoursProfile`/`WorkingHoursSlot`s and the singleton
 *  `HandoverConfig`. Idempotent: a re-run finds the existing `Channel` rows by their real
 *  unique `key` and does nothing further. */
export async function seedChannelsAndHandoverHours(input: SeedChannelsDemoDataInput): Promise<{
  readonly webWidgetChannelId: string;
  readonly whatsAppChannelId: string;
}> {
  const db = getTenantDb();
  const existing = await db.channel.findMany();
  if (existing.length > 0) {
    const webWidget = existing.find((c) => c.key === "WebWidget");
    const whatsApp = existing.find((c) => c.key === "WhatsApp");
    if (webWidget && whatsApp) {
      return { webWidgetChannelId: webWidget.id, whatsAppChannelId: whatsApp.id };
    }
  }

  const { now, boundAgentId, defaultQueueTeamId } = input;

  const profile = await db.workingHoursProfile.create({
    data: {
      id: newUlid(now),
      name: "Standard staffed hours",
      timezone: "Asia/Dubai",
      publicHolidayAutoSync: true,
      assistantAvailable247: true,
      noAgentAvailableMessage:
        "Our live agents are currently offline. I can keep helping with your request, and a human agent will follow up when the team is back online.",
      createdAt: now,
      updatedAt: now,
      slots: {
        create: [
          // Sun-Thu 08:00-20:00, Sat 09:00-14:00 (0 = Sunday) — the wireframe's own schedule.
          ...[0, 1, 2, 3, 4].map((dayOfWeek) => ({
            id: newUlid(now),
            dayOfWeek,
            opensAt: toPrismaTime({ hour: 8, minute: 0 }),
            closesAt: toPrismaTime({ hour: 20, minute: 0 }),
            createdAt: now,
            updatedAt: now,
          })),
          {
            id: newUlid(now),
            dayOfWeek: 6,
            opensAt: toPrismaTime({ hour: 9, minute: 0 }),
            closesAt: toPrismaTime({ hour: 14, minute: 0 }),
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    },
  });

  await db.handoverConfig.create({
    data: {
      id: newUlid(now),
      singletonKey: 1,
      defaultQueueTeamId,
      maxWaitSecondsBeforeRequeue: 120,
      workingHoursProfileId: profile.id,
      noAgentAvailableMessage: profile.noAgentAvailableMessage,
      // Matches the wireframe's own documented shape: the assistant stays available, and
      // the message above replaces the offer of a handover rather than promising one that
      // cannot be honoured outside staffed hours.
      offerEscalationOutsideHours: false,
      createdAt: now,
      updatedAt: now,
    },
  });

  const webWidget = await db.channel.create({
    data: {
      id: newUlid(now),
      key: "WebWidget",
      displayName: "Web widget",
      boundAgentId,
      state: "Live",
      availability: "TwentyFourSeven",
      enabledAt: now,
      createdAt: now,
      updatedAt: now,
      widgetConfig: {
        create: {
          id: newUlid(now),
          accentTokenKey: "--chart-1",
          launcherPosition: "BottomRight",
          defaultState: "Docked",
          disclaimerText: "This assistant can make mistakes. Verify important information.",
          greetingText: "Hi! I'm the SHJ3 Assistant. How can I help you today?",
          composerPlaceholder: "Ask SHJ3 Assistant",
          showDisclaimerDismiss: true,
          embedSnippetVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
      },
      allowedDomains: {
        create: [
          {
            id: newUlid(now),
            domain: "sharjah.ae",
            addedByStaffUserId: boundAgentId,
            addedAt: now,
            createdAt: now,
            updatedAt: now,
          },
          {
            id: newUlid(now),
            domain: "services.shj.ae",
            addedByStaffUserId: boundAgentId,
            addedAt: now,
            createdAt: now,
            updatedAt: now,
          },
        ],
      },
    },
  });

  const whatsApp = await db.channel.create({
    data: {
      id: newUlid(now),
      key: "WhatsApp",
      displayName: "WhatsApp",
      boundAgentId,
      state: "Live",
      availability: "TwentyFourSeven",
      enabledAt: now,
      createdAt: now,
      updatedAt: now,
      whatsAppConfig: {
        create: {
          id: newUlid(now),
          phoneNumber: "+971800SEWA",
          phoneNumberId: "shj3-sewa-whatsapp-demo",
          wabaId: "shj3-sewa-waba-demo",
          bspProvider: "MetaCloudApi",
          optInRequired: true,
          sessionWindowHours: 24,
          credentialSecretRef: "env:SHJ3_WHATSAPP_APP_SECRET",
          webhookVerifySecretRef: "env:SHJ3_WHATSAPP_WEBHOOK_VERIFY_TOKEN",
          createdAt: now,
          updatedAt: now,
        },
      },
    },
  });

  await db.channel.create({
    data: {
      id: newUlid(now),
      key: "MobileApp",
      displayName: "Mobile app",
      state: "Disabled",
      availability: "TwentyFourSeven",
      disabledAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });
  await db.channel.create({
    data: {
      id: newUlid(now),
      key: "KioskIvr",
      displayName: "Kiosk / IVR",
      state: "Disabled",
      availability: "TwentyFourSeven",
      disabledAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  return { webWidgetChannelId: webWidget.id, whatsAppChannelId: whatsApp.id };
}

/** B10 tab 3's three templates and B10 tab 4's three campaigns. Depends on
 *  `seedChannelsAndHandoverHours` having already run (needs no id from it directly, but
 *  should follow it so the WhatsApp channel exists first). */
export async function seedTemplatesAndCampaigns(now: Date): Promise<void> {
  const db = getTenantDb();
  const existing = await db.messageTemplate.findMany();
  if (existing.length > 0) return;

  const welcome = await db.messageTemplate.create({
    data: {
      id: newUlid(now),
      name: "welcome_message",
      channelKey: "WhatsApp",
      category: "Utility",
      bodySample: "Welcome to SHJ3 Assistant! Reply STOP at any time to opt out.",
      variablesJson: JSON.stringify([]),
      localeCode: "en",
      approvalStatus: "Approved",
      bspTemplateId: "shj3-demo-welcome_message-en",
      submittedAt: now,
      reviewedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  const billReminder = await db.messageTemplate.create({
    data: {
      id: newUlid(now),
      name: "bill_reminder",
      channelKey: "WhatsApp",
      category: "Utility",
      bodySample: "Hi {{1}}, your SEWA bill of {{2}} is due on {{3}}. Reply PAY to settle it now.",
      variablesJson: JSON.stringify(["customerName", "amountDue", "dueDate"]),
      localeCode: "en",
      approvalStatus: "Approved",
      bspTemplateId: "shj3-demo-bill_reminder-en",
      submittedAt: now,
      reviewedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  const paymentReceipt = await db.messageTemplate.create({
    data: {
      id: newUlid(now),
      name: "payment_receipt",
      channelKey: "WhatsApp",
      category: "Utility",
      bodySample: "Thanks {{1}}! We received your payment of {{2}} on {{3}}.",
      variablesJson: JSON.stringify(["customerName", "amountPaid", "paidDate"]),
      localeCode: "en",
      approvalStatus: "Approved",
      bspTemplateId: "shj3-demo-payment_receipt-en",
      submittedAt: now,
      reviewedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  const appointmentConfirmation = await db.messageTemplate.create({
    data: {
      id: newUlid(now),
      name: "appointment_confirmation",
      channelKey: "WhatsApp",
      category: "Utility",
      bodySample: "Hi {{1}}, your Jawaher Centre appointment is confirmed for {{2}}.",
      variablesJson: JSON.stringify(["customerName", "appointmentTime"]),
      localeCode: "en",
      // Seeded Pending, matching the wireframe exactly — this is the template whose
      // approval (via ApproveMessageTemplate) is what unblocks its campaign below.
      approvalStatus: "Pending",
      submittedAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  await db.campaign.create({
    data: {
      id: newUlid(now),
      name: "Bill due reminder",
      messageTemplateId: billReminder.id,
      trigger: "RelativeToDueDate",
      triggerOffsetHours: -72,
      audienceDefinitionJson: JSON.stringify({ segment: "opted_in_sewa_customers" }),
      audienceLabel: "Opted-in SEWA customers",
      isEnabled: true,
      respectQuietHours: true,
      sentThisMonth: 4210,
      lastSentAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  // "Blocked" — its template is Pending, and TR_Campaigns_templateMustBeApproved would
  // refuse isEnabled: true here; seeded off (Blocked is derived from the template, not
  // stored) to match the wireframe's own state exactly.
  await db.campaign.create({
    data: {
      id: newUlid(now),
      name: "Appointment confirmation",
      messageTemplateId: appointmentConfirmation.id,
      trigger: "OnBookingCreated",
      audienceDefinitionJson: JSON.stringify({ segment: "jawaher_centre_bookings" }),
      audienceLabel: "Jawaher Centre bookings",
      isEnabled: false,
      respectQuietHours: true,
      sentThisMonth: 0,
      createdAt: now,
      updatedAt: now,
    },
  });

  await db.campaign.create({
    data: {
      id: newUlid(now),
      name: "Payment receipt",
      messageTemplateId: paymentReceipt.id,
      trigger: "OnPaymentSettled",
      audienceDefinitionJson: JSON.stringify({ segment: "all_payers" }),
      audienceLabel: "All payers",
      isEnabled: true,
      respectQuietHours: true,
      sentThisMonth: 1880,
      lastSentAt: now,
      createdAt: now,
      updatedAt: now,
    },
  });

  // welcome_message has no campaign of its own in the wireframe (it is sent on first
  // contact, not on a schedule) — created above purely so tab 3's table has all three
  // seeded template rows.
  void welcome;
}

/** B10 tab 4's quiet hours singleton. */
export async function seedQuietHours(now: Date): Promise<void> {
  const db = getTenantDb();
  const existing = await db.quietHoursConfig.findUnique({ where: { singletonKey: 1 } });
  if (existing) return;
  await db.quietHoursConfig.create({
    data: {
      id: newUlid(now),
      singletonKey: 1,
      isEnabled: true,
      startsAt: toPrismaTime({ hour: 21, minute: 0 }),
      endsAt: toPrismaTime({ hour: 7, minute: 0 }),
      timezone: "Asia/Dubai",
      createdAt: now,
      updatedAt: now,
    },
  });
}

/** B10 tab 5's two locales — `LocaleSetting` rows referencing the already-seeded
 *  `platform.Locale` catalogue (never creates a `platform.Locale` row itself; that catalogue
 *  is a different module's seed). */
export async function seedLocaleSettings(now: Date): Promise<void> {
  const tenantDb = getTenantDb();
  const platformDb = getPlatformDb();
  const existing = await tenantDb.localeSetting.findMany();
  if (existing.length > 0) return;

  const locales = await platformDb.locale.findMany({ where: { code: { in: ["en", "ar"] } } });
  const codes = new Set(locales.map((l) => l.code));
  if (!codes.has("en") || !codes.has("ar")) {
    throw new Error(
      "seedLocaleSettings: platform.Locale must already have 'en' and 'ar' rows " +
        "(a different module's own seed) before this tenant-side seed can reference them.",
    );
  }

  await tenantDb.localeSetting.create({
    data: {
      id: newUlid(now),
      localeCode: "en",
      isEnabled: true,
      voiceName: "Aria (EN)",
      translatedStringCount: 100,
      totalStringCount: 100,
      isFallback: true,
      createdAt: now,
      updatedAt: now,
    },
  });
  await tenantDb.localeSetting.create({
    data: {
      id: newUlid(now),
      localeCode: "ar",
      isEnabled: true,
      voiceName: "Layla (AR)",
      translatedStringCount: 82,
      totalStringCount: 100,
      isFallback: false,
      createdAt: now,
      updatedAt: now,
    },
  });
}
