import { describe, expect, it, vi, beforeEach } from "vitest";

const createConnectorMock = vi.fn();
const discoverToolsMock = vi.fn();
const listConnectorsMock = vi.fn();
const findConnectorByIdMock = vi.fn();

vi.mock("../application/create-connector.js", () => ({ createConnector: (...a: unknown[]) => createConnectorMock(...a) }));
vi.mock("../application/discover-tools.js", () => ({ discoverTools: (...a: unknown[]) => discoverToolsMock(...a) }));
vi.mock("../infrastructure/connector-repository.js", () => ({
  listConnectors: (...a: unknown[]) => listConnectorsMock(...a),
  findConnectorById: (...a: unknown[]) => findConnectorByIdMock(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };

describe("connectors http/admin-routes (unit, mocked application layer)", () => {
  beforeEach(() => {
    createConnectorMock.mockReset();
    discoverToolsMock.mockReset();
    listConnectorsMock.mockReset();
    findConnectorByIdMock.mockReset();
  });

  it("handleListConnectors delegates to the repository", async () => {
    listConnectorsMock.mockResolvedValue([{ id: "c1" }]);
    const { handleListConnectors } = await import("./admin-routes.js");
    expect(await handleListConnectors(ctx)).toEqual([{ id: "c1" }]);
    expect(listConnectorsMock).toHaveBeenCalledWith(ctx);
  });

  it("handleGetConnector delegates to the repository", async () => {
    findConnectorByIdMock.mockResolvedValue({ id: "c1" });
    const { handleGetConnector } = await import("./admin-routes.js");
    expect(await handleGetConnector(ctx, "c1")).toEqual({ id: "c1" });
    expect(findConnectorByIdMock).toHaveBeenCalledWith(ctx, "c1");
  });

  it("handleCreateConnector delegates to the application service", async () => {
    createConnectorMock.mockResolvedValue({ id: "new-connector" });
    const { handleCreateConnector } = await import("./admin-routes.js");
    const input = { name: "X", backendType: "CRM", transport: "StreamableHTTP", authMethod: "None", environment: "Sandbox" } as never;
    const result = await handleCreateConnector(ctx, input);
    expect(result).toEqual({ id: "new-connector" });
    expect(createConnectorMock).toHaveBeenCalledWith(ctx, input);
  });

  it("handleDiscoverTools delegates to the discovery service", async () => {
    discoverToolsMock.mockResolvedValue([]);
    const { handleDiscoverTools } = await import("./admin-routes.js");
    await handleDiscoverTools(ctx, "c1");
    expect(discoverToolsMock).toHaveBeenCalledWith(ctx, "c1");
  });
});
