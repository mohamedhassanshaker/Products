import { afterEach, describe, expect, it } from "vitest";
import { startMockMcpServer, type MockMcpServerHandle } from "@nextbot/testing";
import { listResources } from "./list-resources.js";
import { McpTransportError } from "../infrastructure/streamable-http-transport.js";

describe("listResources (BL-34 discovery handshake, Streamable HTTP transport against a real HTTP server)", () => {
  let handle: MockMcpServerHandle | undefined;

  afterEach(async () => {
    await handle?.close();
    handle = undefined;
  });

  it("lists resources exposed by a real (mock) MCP server", async () => {
    handle = await startMockMcpServer([], {
      resources: [
        { uri: "kb://faq", name: "FAQ", mimeType: "text/markdown" },
        { uri: "kb://policies", name: "Policies" },
      ],
    });

    const resources = await listResources({ endpointUrl: handle.url });
    expect(resources.map((r) => r.uri).sort()).toEqual(["kb://faq", "kb://policies"]);
  });

  it("surfaces a transport failure verbatim", async () => {
    await expect(listResources({ endpointUrl: "http://127.0.0.1:1/unreachable", timeoutMs: 1000 })).rejects.toThrow(McpTransportError);
  });
});
