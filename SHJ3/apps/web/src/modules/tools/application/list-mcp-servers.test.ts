import { describe, expect, it } from "vitest";
import { FakeMcpServerRepository, mcpServerRowFixture } from "../testing/fakes.js";
import { ListMcpServers } from "./list-mcp-servers.js";

describe("listing MCP servers", () => {
  it("returns every registered server", async () => {
    const servers = new FakeMcpServerRepository();
    servers.seed(mcpServerRowFixture({ id: "mcp_a", name: "Sharjah Services Gateway" }));
    servers.seed(
      mcpServerRowFixture({
        id: "mcp_b",
        name: "Sharjah Customs MCP",
        connectionState: "NotConnected",
      }),
    );

    const list = new ListMcpServers({ servers });
    const { rows } = await list.execute();

    expect(rows.map((r) => r.id).sort()).toEqual(["mcp_a", "mcp_b"]);
  });

  it("returns an empty list when none are registered", async () => {
    const servers = new FakeMcpServerRepository();
    const list = new ListMcpServers({ servers });
    expect((await list.execute()).rows).toEqual([]);
  });
});
