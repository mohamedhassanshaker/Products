import { describe, expect, it } from "vitest";
import { FakeMcpServerRepository } from "../testing/fakes.js";
import { CreateMcpServer } from "./create-mcp-server.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("registering an MCP server", () => {
  it("starts NotConnected with no discovered tools", async () => {
    const servers = new FakeMcpServerRepository();
    const create = new CreateMcpServer({ servers });

    const { server } = await create.execute({
      name: "Sharjah Customs MCP",
      endpoint: "mcp://customs.shj.ae",
      transport: "StreamableHttp",
      authMode: "MutualTls",
      credentialSecretRef: "env:MCP_CUSTOMS_CERT",
      now: NOW,
    });

    expect(server.connectionState).toBe("NotConnected");
    expect(server.lastDiscoveryAt).toBeNull();
    expect(await servers.listTools(server.id)).toEqual([]);
    expect(await servers.list()).toEqual([server]);
  });
});
