import { describe, expect, it } from "vitest";
import { RemoveWidgetAllowedDomain } from "./remove-widget-allowed-domain.js";
import type { ChannelRepository, ChannelRow } from "../ports/channel-repository.js";
import type {
  WidgetAllowedDomainRow,
  WidgetConfigRepository,
} from "../ports/widget-config-repository.js";

function fakeChannels(state: ChannelRow["state"]): ChannelRepository {
  const row: ChannelRow = {
    id: "chan_01",
    key: "WebWidget",
    displayName: "Web widget",
    boundAgentId: "agent_01",
    boundAgentName: "SEWA & Utilities Billing Agent",
    state,
    availability: "TwentyFourSeven",
    workingHoursProfileId: null,
  };
  return {
    async list() {
      return [row];
    },
    async findById() {
      return row;
    },
    async update() {},
    async countOpenConversations() {
      return 0;
    },
    async createDefault() {
      throw new Error("not used in this test");
    },
  };
}

function fakeWidgetConfig(domains: readonly WidgetAllowedDomainRow[]): WidgetConfigRepository & {
  removed: string[];
} {
  const removed: string[] = [];
  return {
    removed,
    async findByChannelId() {
      return null;
    },
    async update() {
      throw new Error("not used in this test");
    },
    async listAllowedDomains() {
      return domains;
    },
    async addAllowedDomain() {
      throw new Error("not used in this test");
    },
    async removeAllowedDomain(channelId, domain) {
      removed.push(`${channelId}:${domain}`);
    },
    async createDefault() {
      throw new Error("not used in this test");
    },
  };
}

const ONE_DOMAIN: readonly WidgetAllowedDomainRow[] = [
  { id: "d1", domain: "sharjah.ae", addedByStaffUserId: "staff_01", addedAt: new Date() },
];

describe("RemoveWidgetAllowedDomain", () => {
  it("refuses to remove the last domain while the channel is Live", async () => {
    const widgetConfig = fakeWidgetConfig(ONE_DOMAIN);
    const useCase = new RemoveWidgetAllowedDomain({ widgetConfig, channels: fakeChannels("Live") });

    const result = await useCase.execute({ channelId: "chan_01", domain: "sharjah.ae" });

    expect(result).toEqual({ ok: false, reason: "channels.allowlist_empty_while_live" });
    expect(widgetConfig.removed).toHaveLength(0);
  });

  it("allows removing the last domain while the channel is Disabled", async () => {
    const widgetConfig = fakeWidgetConfig(ONE_DOMAIN);
    const useCase = new RemoveWidgetAllowedDomain({
      widgetConfig,
      channels: fakeChannels("Disabled"),
    });

    const result = await useCase.execute({ channelId: "chan_01", domain: "sharjah.ae" });

    expect(result).toEqual({ ok: true });
    expect(widgetConfig.removed).toEqual(["chan_01:sharjah.ae"]);
  });

  it("allows removing a domain that is not the last one, even while Live", async () => {
    const twoDomains: readonly WidgetAllowedDomainRow[] = [
      ...ONE_DOMAIN,
      { id: "d2", domain: "services.shj.ae", addedByStaffUserId: "staff_01", addedAt: new Date() },
    ];
    const widgetConfig = fakeWidgetConfig(twoDomains);
    const useCase = new RemoveWidgetAllowedDomain({ widgetConfig, channels: fakeChannels("Live") });

    const result = await useCase.execute({ channelId: "chan_01", domain: "sharjah.ae" });

    expect(result).toEqual({ ok: true });
    expect(widgetConfig.removed).toEqual(["chan_01:sharjah.ae"]);
  });
});
