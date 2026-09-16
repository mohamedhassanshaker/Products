import { describe, expect, it } from "vitest";
import {
  FakeMcpDiscoveryClient,
  FakeMcpServerRepository,
  mcpServerRowFixture,
} from "../testing/fakes.js";
import { ConnectAndDiscoverMcpServer } from "./connect-and-discover-mcp-server.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

function harness() {
  const servers = new FakeMcpServerRepository();
  const discovery = new FakeMcpDiscoveryClient();
  servers.seed(mcpServerRowFixture({ id: "mcp_a", connectionState: "NotConnected" }));
  return { servers, discovery, useCase: new ConnectAndDiscoverMcpServer({ servers, discovery }) };
}

describe("connecting to and discovering tools from an MCP server", () => {
  it("returns tools.server_not_found for an id that does not exist, without calling the discovery client", async () => {
    const { discovery, useCase } = harness();
    const result = await useCase.execute({ mcpServerId: "mcp_ghost", now: NOW });
    expect(result).toEqual({ ok: false, reason: "tools.server_not_found" });
    expect(discovery.calls).toHaveLength(0);
  });

  it("calls the discovery client with the server's own persisted config, not caller-supplied values", async () => {
    const { servers, discovery, useCase } = harness();
    servers.seed(
      mcpServerRowFixture({
        id: "mcp_a",
        endpoint: "mcp://sharjah-services.internal",
        transport: "StreamableHttp",
        authMode: "OAuth2ClientCredentials",
        credentialSecretRef: "env:MCP_SHARJAH_SERVICES_TOKEN",
      }),
    );
    discovery.setResult({ ok: true, tools: [] });

    await useCase.execute({ mcpServerId: "mcp_a", now: NOW });

    expect(discovery.calls).toEqual([
      {
        mcpServerId: "mcp_a",
        config: {
          endpoint: "mcp://sharjah-services.internal",
          transport: "StreamableHttp",
          authMode: "OAuth2ClientCredentials",
          credentialSecretRef: "env:MCP_SHARJAH_SERVICES_TOKEN",
        },
      },
    ]);
  });

  it("on ok:true, persists the discovered tools and returns the persisted rows, marking the server Connected", async () => {
    const { servers, discovery, useCase } = harness();
    discovery.setResult({
      ok: true,
      tools: [
        { name: "get_declaration_status", description: null, inputSchemaJson: "{}" },
        { name: "submit_customs_form", description: null, inputSchemaJson: "{}" },
      ],
    });

    const result = await useCase.execute({ mcpServerId: "mcp_a", now: NOW });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.tools.map((t) => t.name).sort()).toEqual([
        "get_declaration_status",
        "submit_customs_form",
      ]);
    }
    const server = await servers.get("mcp_a");
    expect(server?.connectionState).toBe("Connected");
    expect(server?.lastDiscoveryAt).toEqual(NOW);
  });

  it.each([
    ["dns", "DNS resolution failed while connecting to the MCP server."],
    ["tls", "TLS handshake failed while connecting to the MCP server."],
    ["auth", "Authentication was rejected while connecting to the MCP server."],
    ["timeout", "Connecting to the MCP server timed out."],
    ["protocol", "The MCP server responded, but not with a valid MCP handshake."],
  ] as const)(
    "on %s, records the fixed message and propagates the same reason",
    async (reason, expectedMessage) => {
      const { servers, useCase, discovery } = harness();
      discovery.setResult({ ok: false, reason });

      const result = await useCase.execute({ mcpServerId: "mcp_a", now: NOW });

      expect(result).toEqual({ ok: false, reason });
      const server = await servers.get("mcp_a");
      expect(server?.connectionState).toBe("Failed");
      expect(server?.lastError).toBe(expectedMessage);
    },
  );

  it("on empty, records a fixed message and propagates reason 'empty'", async () => {
    const { servers, useCase, discovery } = harness();
    discovery.setResult({ ok: false, reason: "empty" });

    const result = await useCase.execute({ mcpServerId: "mcp_a", now: NOW });

    expect(result).toEqual({ ok: false, reason: "empty" });
    expect((await servers.get("mcp_a"))?.lastError).toBe(
      "The MCP server connected successfully but discovered zero tools.",
    );
  });

  it("on ai_runtime_unavailable, records and propagates the detail verbatim — the honest 'apps/ai endpoint does not exist yet' outcome", async () => {
    const { servers, useCase, discovery } = harness();
    const detail = "The AI service responded with 404 for POST /tools/mcp/servers/mcp_a/connect.";
    discovery.setResult({ ok: false, reason: "ai_runtime_unavailable", detail });

    const result = await useCase.execute({ mcpServerId: "mcp_a", now: NOW });

    expect(result).toEqual({ ok: false, reason: "ai_runtime_unavailable", detail });
    const server = await servers.get("mcp_a");
    expect(server?.connectionState).toBe("Failed");
    expect(server?.lastError).toBe(detail);
  });

  it("never misreports ai_runtime_unavailable as one of the documented handshake reasons", async () => {
    const { useCase, discovery } = harness();
    discovery.setResult({
      ok: false,
      reason: "ai_runtime_unavailable",
      detail: "route not mounted",
    });

    const result = await useCase.execute({ mcpServerId: "mcp_a", now: NOW });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).not.toBe("protocol");
      expect(result.reason).toBe("ai_runtime_unavailable");
    }
  });
});
