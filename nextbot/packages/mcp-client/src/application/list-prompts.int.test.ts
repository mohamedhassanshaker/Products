import { afterEach, describe, expect, it } from "vitest";
import { startMockMcpServer, type MockMcpServerHandle } from "@nextbot/testing";
import { listPrompts } from "./list-prompts.js";
import { McpTransportError } from "../infrastructure/streamable-http-transport.js";

describe("listPrompts (BL-34 discovery handshake, Streamable HTTP transport against a real HTTP server)", () => {
  let handle: MockMcpServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("lists prompts exposed by a real (mock) MCP server", async () => {
    handle = await startMockMcpServer([], {
      prompts: [{ name: "summarize_ticket", arguments: [{ name: "ticketId", required: true }] }],
    });

    const prompts = await listPrompts({ endpointUrl: handle.url });
    expect(prompts.map((p) => p.name)).toEqual(["summarize_ticket"]);
  });

  it("surfaces a transport failure verbatim", async () => {
    await expect(listPrompts({ endpointUrl: "http://127.0.0.1:1/unreachable", timeoutMs: 1000 })).rejects.toThrow(McpTransportError);
  });
});
