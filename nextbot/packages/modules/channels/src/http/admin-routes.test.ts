import { describe, expect, it, vi, beforeEach } from "vitest";

const createWebWidgetChannelMock = vi.fn();
const listChannelsMock = vi.fn();

vi.mock("../application/create-web-widget-channel.js", () => ({
  createWebWidgetChannel: (...a: unknown[]) => createWebWidgetChannelMock(...a),
}));
vi.mock("../infrastructure/channel-repository.js", () => ({
  listChannels: (...a: unknown[]) => listChannelsMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("channels http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    createWebWidgetChannelMock.mockReset();
    listChannelsMock.mockReset();
  });

  it("handleListChannels delegates to the repository", async () => {
    listChannelsMock.mockResolvedValue([{ id: "c1" }]);
    const { handleListChannels } = await import("./admin-routes.js");
    expect(await handleListChannels(ctx)).toEqual([{ id: "c1" }]);
    expect(listChannelsMock).toHaveBeenCalledWith(ctx);
  });

  it("handleCreateWebWidgetChannel delegates to the application service", async () => {
    createWebWidgetChannelMock.mockResolvedValue({ id: "new-channel" });
    const { handleCreateWebWidgetChannel } = await import("./admin-routes.js");
    const input = { name: "X", environment: "Sandbox" } as never;
    const result = await handleCreateWebWidgetChannel(ctx, input);
    expect(result).toEqual({ id: "new-channel" });
    expect(createWebWidgetChannelMock).toHaveBeenCalledWith(ctx, input);
  });
});
