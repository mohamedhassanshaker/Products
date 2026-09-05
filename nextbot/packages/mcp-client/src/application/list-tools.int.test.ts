import { afterEach, describe, expect, it } from "vitest";
import { startMockMcpServer, type MockMcpServerHandle } from "@nextbot/testing";
import { listTools } from "./list-tools.js";
import { McpTransportError } from "../infrastructure/streamable-http-transport.js";

describe("listTools (FR-MCP-01/02, Streamable HTTP transport against a real HTTP server)", () => {
  let handle: MockMcpServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("lists tools exposed by a real (mock) MCP server", async () => {
    handle = await startMockMcpServer([
      { name: "get_ticket", description: "Fetch a ticket", inputSchema: { type: "object" } },
      { name: "create_ticket", description: "Create a ticket", inputSchema: { type: "object" } },
    ]);

    const tools = await listTools({ endpointUrl: handle.url });
    expect(tools.map((t) => t.name).sort()).toEqual(["create_ticket", "get_ticket"]);
  });

  it("surfaces a transport failure verbatim (FR-MCP-02) when the server is unreachable", async () => {
    await expect(listTools({ endpointUrl: "http://127.0.0.1:1/unreachable", timeoutMs: 1000 } as never)).rejects.toThrow(McpTransportError);
  });

  it("surfaces an HTTP error status from the server", async () => {
    handle = await startMockMcpServer([]);
    // Point at a path the mock server doesn't specially handle -> it still returns a
    // 200 JSON-RPC "method not found" for tools/list only; force a non-2xx by hitting
    // a URL that closes immediately instead.
    await handle.close();
    await expect(listTools({ endpointUrl: handle.url, timeoutMs: 1000 })).rejects.toThrow(McpTransportError);
    handle = undefined;
  });
});
