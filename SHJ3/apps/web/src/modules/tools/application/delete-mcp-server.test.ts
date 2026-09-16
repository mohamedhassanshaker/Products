import { describe, expect, it } from "vitest";
import { FakeMcpServerRepository, mcpServerRowFixture } from "../testing/fakes.js";
import { DeleteMcpServer } from "./delete-mcp-server.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("deleting an MCP server", () => {
  it("soft-deletes a server with no active bindings", async () => {
    const servers = new FakeMcpServerRepository();
    servers.seed(mcpServerRowFixture({ id: "mcp_a" }));
    const del = new DeleteMcpServer({ servers });

    expect(await del.execute({ id: "mcp_a", now: NOW })).toEqual({ ok: true });
    expect(await servers.get("mcp_a")).toBeNull();
  });

  it("refuses, naming the bound agent versions, when a discovered tool is still in use", async () => {
    const servers = new FakeMcpServerRepository();
    servers.seed(mcpServerRowFixture({ id: "mcp_a" }));
    servers.blockDelete("mcp_a", ["agentver_1"]);
    const del = new DeleteMcpServer({ servers });

    const result = await del.execute({ id: "mcp_a", now: NOW });
    expect(result).toEqual({
      ok: false,
      reason: "tools.server_in_use",
      boundAgentVersionIds: ["agentver_1"],
    });
    expect(await servers.get("mcp_a")).not.toBeNull();
  });
});
