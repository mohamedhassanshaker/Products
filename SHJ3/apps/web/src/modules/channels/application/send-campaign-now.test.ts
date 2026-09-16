import { describe, expect, it } from "vitest";
import { SendCampaignNow } from "./send-campaign-now.js";
import type {
  CampaignRepository,
  CampaignRow,
  NewCampaignSendInput,
} from "../ports/campaign-repository.js";
import type { ConsentRepository, ConsentStateRow } from "../ports/consent-repository.js";
import type { QuietHoursConfigRow, QuietHoursRepository } from "../ports/quiet-hours-repository.js";

function baseCampaign(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    id: "camp_01",
    name: "Bill due reminder",
    messageTemplateId: "tmpl_01",
    messageTemplateName: "bill_reminder",
    messageTemplateChannelKey: "WhatsApp",
    templateApprovalStatus: "Approved",
    trigger: "RelativeToDueDate",
    triggerOffsetHours: -72,
    audienceLabel: "Opted-in SEWA customers",
    isEnabled: true,
    respectQuietHours: true,
    sentThisMonth: 0,
    lastSentAt: null,
    state: "On",
    ...overrides,
  };
}

function fakeCampaigns(
  campaign: CampaignRow | null,
): CampaignRepository & { sends: NewCampaignSendInput[] } {
  const sends: NewCampaignSendInput[] = [];
  const seenKeys = new Set<string>();
  return {
    sends,
    async list() {
      return campaign ? [campaign] : [];
    },
    async findById() {
      return campaign;
    },
    async create() {
      throw new Error("not used");
    },
    async update() {},
    async setEnabled() {},
    async listSends() {
      return [];
    },
    async recordSend(input) {
      sends.push(input);
      if (seenKeys.has(input.idempotencyKey)) return { inserted: false };
      seenKeys.add(input.idempotencyKey);
      return { inserted: true };
    },
    async incrementSentThisMonth() {},
  };
}

function fakeConsent(optedIn: ReadonlySet<string>): ConsentRepository {
  return {
    async currentState(subjectHash): Promise<ConsentStateRow | null> {
      if (!optedIn.has(subjectHash)) return null;
      return {
        subjectHash,
        channelKey: "WhatsApp",
        purpose: "ProactiveMessaging",
        state: "OptedIn",
        effectiveAt: new Date(),
      };
    },
    async appendLedgerEntry() {},
    async listOptedIn() {
      return [];
    },
  };
}

function fakeQuietHours(config: QuietHoursConfigRow | null): QuietHoursRepository {
  return {
    async getSingleton() {
      return config;
    },
    async update() {},
  };
}

const NOON_DUBAI = new Date("2026-09-09T08:00:00Z"); // 12:00 Asia/Dubai
const QUIET_HOURS: QuietHoursConfigRow = {
  id: "qh_01",
  isEnabled: true,
  startsAt: { hour: 21, minute: 0 },
  endsAt: { hour: 7, minute: 0 },
  timezone: "Asia/Dubai",
};

describe("SendCampaignNow", () => {
  it("aborts the whole batch when the template is not Approved", async () => {
    const campaigns = fakeCampaigns(baseCampaign({ templateApprovalStatus: "Pending" }));
    const useCase = new SendCampaignNow({
      campaigns,
      consent: fakeConsent(new Set()),
      quietHours: fakeQuietHours(null),
    });

    const result = await useCase.execute({
      campaignId: "camp_01",
      recipients: [{ subjectHash: "hash1", citizenIdentityId: null }],
      triggerOccurrenceKey: "manual-1",
      now: NOON_DUBAI,
    });

    expect(result).toEqual({ ok: false, reason: "channels.template_not_approved" });
    expect(campaigns.sends).toHaveLength(0);
  });

  it("refuses up front (409-shaped) when quiet hours are in effect and the campaign respects them", async () => {
    const campaigns = fakeCampaigns(baseCampaign());
    const useCase = new SendCampaignNow({
      campaigns,
      consent: fakeConsent(new Set(["hash1"])),
      quietHours: fakeQuietHours(QUIET_HOURS),
    });

    // 22:00 Asia/Dubai = 18:00 UTC — inside the 21:00-07:00 window.
    const result = await useCase.execute({
      campaignId: "camp_01",
      recipients: [{ subjectHash: "hash1", citizenIdentityId: null }],
      triggerOccurrenceKey: "manual-1",
      now: new Date("2026-09-09T18:00:00Z"),
    });

    expect(result).toEqual({ ok: false, reason: "channels.quiet_hours" });
    expect(campaigns.sends).toHaveLength(0);
  });

  it("sends to opted-in recipients and suppresses recipients with no recorded opt-in", async () => {
    const campaigns = fakeCampaigns(baseCampaign());
    const useCase = new SendCampaignNow({
      campaigns,
      consent: fakeConsent(new Set(["opted-in-hash"])),
      quietHours: fakeQuietHours(QUIET_HOURS),
    });

    const result = await useCase.execute({
      campaignId: "camp_01",
      recipients: [
        { subjectHash: "opted-in-hash", citizenIdentityId: "ci_1" },
        { subjectHash: "no-optin-hash", citizenIdentityId: "ci_2" },
      ],
      triggerOccurrenceKey: "manual-1",
      now: NOON_DUBAI,
    });

    expect(result).toEqual({ ok: true, sent: 1, suppressed: 1, throttled: 0 });
    const suppressedSend = campaigns.sends.find((s) => s.recipientHash === "no-optin-hash");
    expect(suppressedSend?.state).toBe("Suppressed");
    expect(suppressedSend?.suppressionReason).toBe("NoOptIn");
  });

  it("skips a duplicate send silently on a repeated idempotency key (replay safety)", async () => {
    const campaigns = fakeCampaigns(baseCampaign());
    const useCase = new SendCampaignNow({
      campaigns,
      consent: fakeConsent(new Set(["hash1"])),
      quietHours: fakeQuietHours(QUIET_HOURS),
    });

    const input = {
      campaignId: "camp_01",
      recipients: [{ subjectHash: "hash1", citizenIdentityId: null }],
      triggerOccurrenceKey: "manual-1",
      now: NOON_DUBAI,
    };
    const first = await useCase.execute(input);
    const second = await useCase.execute(input);

    expect(first).toEqual({ ok: true, sent: 1, suppressed: 0, throttled: 0 });
    // The second call's recipient hits the same idempotency key and is skipped, not double-sent.
    expect(second).toEqual({ ok: true, sent: 0, suppressed: 0, throttled: 0 });
  });

  it("throttles recipients once the remaining daily cap is exhausted", async () => {
    const campaigns = fakeCampaigns(baseCampaign());
    const useCase = new SendCampaignNow({
      campaigns,
      consent: fakeConsent(new Set(["hash1", "hash2"])),
      quietHours: fakeQuietHours(QUIET_HOURS),
    });

    const result = await useCase.execute({
      campaignId: "camp_01",
      recipients: [
        { subjectHash: "hash1", citizenIdentityId: null },
        { subjectHash: "hash2", citizenIdentityId: null },
      ],
      triggerOccurrenceKey: "manual-1",
      remainingDailyCap: 1,
      now: NOON_DUBAI,
    });

    expect(result).toEqual({ ok: true, sent: 1, suppressed: 0, throttled: 1 });
  });
});
