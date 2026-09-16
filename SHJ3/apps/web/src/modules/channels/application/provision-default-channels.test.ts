import { describe, expect, it } from "vitest";
import { ProvisionDefaultChannelsForTenant } from "./provision-default-channels.js";
import { CHANNEL_KEYS } from "../domain/vocabulary.js";
import type {
  ChannelRepository,
  ChannelRow,
  CreateDefaultChannelInput,
} from "../ports/channel-repository.js";
import type {
  CreateDefaultWidgetConfigInput,
  WidgetConfigRepository,
  WidgetConfigRow,
} from "../ports/widget-config-repository.js";

function fakeChannels(initial: readonly ChannelRow[] = []): ChannelRepository & {
  created: CreateDefaultChannelInput[];
} {
  const rows: ChannelRow[] = [...initial];
  const created: CreateDefaultChannelInput[] = [];
  return {
    created,
    async list() {
      return rows;
    },
    async findById(id) {
      return rows.find((r) => r.id === id) ?? null;
    },
    async update() {
      throw new Error("not used in this test");
    },
    async countOpenConversations() {
      return 0;
    },
    async createDefault(input) {
      created.push(input);
      const row: ChannelRow = {
        id: `chan_${input.key}`,
        key: input.key,
        displayName: input.displayName,
        boundAgentId: null,
        boundAgentName: null,
        state: "Disabled",
        availability: "TwentyFourSeven",
        workingHoursProfileId: null,
      };
      rows.push(row);
      return row;
    },
  };
}

function fakeWidgetConfig(initial: readonly WidgetConfigRow[] = []): WidgetConfigRepository & {
  created: CreateDefaultWidgetConfigInput[];
} {
  const rows: WidgetConfigRow[] = [...initial];
  const created: CreateDefaultWidgetConfigInput[] = [];
  return {
    created,
    async findByChannelId(channelId) {
      return rows.find((r) => r.channelId === channelId) ?? null;
    },
    async update() {
      throw new Error("not used in this test");
    },
    async listAllowedDomains() {
      return [];
    },
    async addAllowedDomain() {
      throw new Error("not used in this test");
    },
    async removeAllowedDomain() {
      throw new Error("not used in this test");
    },
    async createDefault(input) {
      created.push(input);
      rows.push({
        id: `wc_${input.channelId}`,
        channelId: input.channelId,
        accentTokenKey: "--chart-1",
        launcherPosition: "BottomRight",
        defaultState: "Docked",
        disclaimerText: "This assistant can make mistakes. Verify important information.",
        greetingText: "Hi! I'm your SHJ3 Assistant. How can I help you today?",
        composerPlaceholder: "Ask SHJ3 Assistant",
        showDisclaimerDismiss: true,
        embedSnippetVersion: 1,
      });
    },
  };
}

const NOW = new Date("2026-09-10T00:00:00Z");

describe("ProvisionDefaultChannelsForTenant", () => {
  it("creates all four fixed channels, Disabled with no bound agent, for a tenant with none", async () => {
    const channels = fakeChannels([]);
    const widgetConfig = fakeWidgetConfig([]);
    const useCase = new ProvisionDefaultChannelsForTenant({ channels, widgetConfig });

    const result = await useCase.execute({ now: NOW });

    expect([...result.createdKeys].sort()).toEqual([...CHANNEL_KEYS].sort());
    expect(channels.created).toHaveLength(4);
    for (const input of channels.created) {
      expect(input.now).toBe(NOW);
    }
    const rows = await channels.list();
    expect(rows.every((r) => r.state === "Disabled")).toBe(true);
    expect(rows.every((r) => r.boundAgentId === null)).toBe(true);
  });

  it("is idempotent: a tenant that already has all four channels gets nothing created", async () => {
    const existing: ChannelRow[] = CHANNEL_KEYS.map((key) => ({
      id: `chan_${key}`,
      key,
      displayName: key,
      boundAgentId: null,
      boundAgentName: null,
      state: "Disabled",
      availability: "TwentyFourSeven",
      workingHoursProfileId: null,
    }));
    const channels = fakeChannels(existing);
    const widgetConfig = fakeWidgetConfig([
      {
        id: "wc_chan_WebWidget",
        channelId: "chan_WebWidget",
        accentTokenKey: "--chart-1",
        launcherPosition: "BottomRight",
        defaultState: "Docked",
        disclaimerText: "x",
        greetingText: "x",
        composerPlaceholder: "x",
        showDisclaimerDismiss: true,
        embedSnippetVersion: 1,
      },
    ]);
    const useCase = new ProvisionDefaultChannelsForTenant({ channels, widgetConfig });

    const result = await useCase.execute({ now: NOW });

    expect(result.createdKeys).toEqual([]);
    expect(result.widgetConfigCreated).toBe(false);
    expect(channels.created).toHaveLength(0);
    expect(widgetConfig.created).toHaveLength(0);
  });

  it("creates only the keys genuinely missing, leaving already-configured channels untouched", async () => {
    // Mirrors the real `sewa` tenant's shape: WebWidget/WhatsApp already hand-seeded and
    // Live, MobileApp/KioskIvr never created. Re-running provisioning must not touch the
    // two real, already-configured rows.
    const existing: ChannelRow[] = [
      {
        id: "chan_web",
        key: "WebWidget",
        displayName: "Web widget",
        boundAgentId: "agent_01",
        boundAgentName: "SEWA Agent",
        state: "Live",
        availability: "TwentyFourSeven",
        workingHoursProfileId: null,
      },
      {
        id: "chan_wa",
        key: "WhatsApp",
        displayName: "WhatsApp",
        boundAgentId: "agent_01",
        boundAgentName: "SEWA Agent",
        state: "Live",
        availability: "TwentyFourSeven",
        workingHoursProfileId: null,
      },
    ];
    const channels = fakeChannels(existing);
    const widgetConfig = fakeWidgetConfig([
      {
        id: "wc_chan_web",
        channelId: "chan_web",
        accentTokenKey: "--chart-1",
        launcherPosition: "BottomRight",
        defaultState: "Docked",
        disclaimerText: "x",
        greetingText: "x",
        composerPlaceholder: "x",
        showDisclaimerDismiss: true,
        embedSnippetVersion: 1,
      },
    ]);
    const useCase = new ProvisionDefaultChannelsForTenant({ channels, widgetConfig });

    const result = await useCase.execute({ now: NOW });

    expect([...result.createdKeys].sort()).toEqual(["KioskIvr", "MobileApp"]);
    expect(result.widgetConfigCreated).toBe(false);
    const rows = await channels.list();
    const webWidget = rows.find((r) => r.key === "WebWidget");
    expect(webWidget?.state).toBe("Live");
    expect(webWidget?.boundAgentId).toBe("agent_01");
  });

  it("provisions WebWidget's default WidgetConfig alongside its Channel row", async () => {
    const channels = fakeChannels([]);
    const widgetConfig = fakeWidgetConfig([]);
    const useCase = new ProvisionDefaultChannelsForTenant({ channels, widgetConfig });

    const result = await useCase.execute({ now: NOW });

    expect(result.widgetConfigCreated).toBe(true);
    expect(widgetConfig.created).toEqual([{ channelId: "chan_WebWidget", now: NOW }]);
  });

  it("backfills WidgetConfig for a WebWidget channel that already exists but has none yet", async () => {
    // The exact real-world shape this fix's own backfill script hits on its second pass:
    // an already-provisioned tenant whose WebWidget Channel row exists (created by an
    // earlier, Channel-only version of this fix) but never got a WidgetConfig.
    const existing: ChannelRow[] = [
      {
        id: "chan_web",
        key: "WebWidget",
        displayName: "Web widget",
        boundAgentId: null,
        boundAgentName: null,
        state: "Disabled",
        availability: "TwentyFourSeven",
        workingHoursProfileId: null,
      },
    ];
    const channels = fakeChannels(existing);
    const widgetConfig = fakeWidgetConfig([]);
    const useCase = new ProvisionDefaultChannelsForTenant({ channels, widgetConfig });

    const result = await useCase.execute({ now: NOW });

    expect(result.createdKeys.includes("WebWidget")).toBe(false);
    expect(result.widgetConfigCreated).toBe(true);
    expect(widgetConfig.created).toEqual([{ channelId: "chan_web", now: NOW }]);
  });

  it("never creates a WhatsAppConfig — WhatsApp has no safe default to fabricate", async () => {
    // No WhatsAppConfigRepository is even a dependency of this use case — this test's real
    // assertion is architectural (the constructor signature itself), reinforced here by
    // confirming a tenant with none still ends up with WhatsApp's Channel row Disabled and
    // nothing else.
    const channels = fakeChannels([]);
    const widgetConfig = fakeWidgetConfig([]);
    const useCase = new ProvisionDefaultChannelsForTenant({ channels, widgetConfig });

    await useCase.execute({ now: NOW });

    const rows = await channels.list();
    const whatsApp = rows.find((r) => r.key === "WhatsApp");
    expect(whatsApp?.state).toBe("Disabled");
  });
});
