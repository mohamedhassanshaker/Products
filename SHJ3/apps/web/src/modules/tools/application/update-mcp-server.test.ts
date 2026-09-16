import { describe, expect, it } from "vitest";
import {
  FakeMcpServerRepository,
  mcpServerRowFixture,
  mcpToolRowFixture,
} from "../testing/fakes.js";
import { UpdateMcpServer } from "./update-mcp-server.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("updating an MCP server registration", () => {
  it("edits only the fields supplied", async () => {
    const servers = new FakeMcpServerRepository();
    servers.seed(
      mcpServerRowFixture({ id: "mcp_a", name: "Old name", connectionState: "Connected" }),
    );
    const update = new UpdateMcpServer({ servers });

    await update.execute({ id: "mcp_a", name: "New name", now: NOW });

    const server = await servers.get("mcp_a");
    expect(server?.name).toBe("New name");
    expect(server?.connectionState).toBe("Connected");
  });

  it("marks the server NotConnected and invalidates its discovered tools when the endpoint changes", async () => {
    const servers = new FakeMcpServerRepository();
    servers.seed(mcpServerRowFixture({ id: "mcp_a", connectionState: "Connected" }));
    servers.seedTool(mcpToolRowFixture({ id: "tool_1", mcpServerId: "mcp_a" }));
    const update = new UpdateMcpServer({ servers });

    await update.execute({ id: "mcp_a", endpoint: "mcp://new-endpoint.internal", now: NOW });

    expect((await servers.get("mcp_a"))?.connectionState).toBe("NotConnected");
    expect(await servers.listTools("mcp_a")).toEqual([]);
  });

  it("marks the server NotConnected when the auth mode changes, even if the endpoint does not", async () => {
    const servers = new FakeMcpServerRepository();
    servers.seed(
      mcpServerRowFixture({ id: "mcp_a", connectionState: "Connected", authMode: "ApiKey" }),
    );
    const update = new UpdateMcpServer({ servers });

    await update.execute({ id: "mcp_a", authMode: "MutualTls", now: NOW });

    expect((await servers.get("mcp_a"))?.connectionState).toBe("NotConnected");
  });

  it("leaves the connection state alone when neither endpoint nor auth mode changes", async () => {
    const servers = new FakeMcpServerRepository();
    servers.seed(mcpServerRowFixture({ id: "mcp_a", connectionState: "Connected" }));
    const update = new UpdateMcpServer({ servers });

    await update.execute({ id: "mcp_a", name: "Renamed only", now: NOW });

    expect((await servers.get("mcp_a"))?.connectionState).toBe("Connected");
  });
});
