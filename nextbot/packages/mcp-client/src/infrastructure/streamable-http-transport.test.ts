import { afterEach, describe, expect, it, vi } from "vitest";
import { sendMcpRequest, McpTransportError } from "./streamable-http-transport.js";

const originalFetch = global.fetch;
afterEach(() => {
  global.fetch = originalFetch;
});

function mockResponse(init: { status?: number; headers?: Record<string, string>; body: string }): Response {
  return {
    ok: (init.status ?? 200) < 300,
    status: init.status ?? 200,
    statusText: "OK",
    headers: { get: (key: string) => init.headers?.[key.toLowerCase()] ?? null } as unknown as Headers,
    text: async () => init.body,
    json: async () => JSON.parse(init.body),
  } as unknown as Response;
}

describe("sendMcpRequest (SSE response parsing branch)", () => {
  it("parses a JSON-RPC result out of a text/event-stream response matching the request id", async () => {
    global.fetch = vi.fn(async (_url, opts) => {
      const body = JSON.parse((opts as RequestInit).body as string) as { id: string };
      const sseBody = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { ok: true } })}\n\n`;
      return mockResponse({ headers: { "content-type": "text/event-stream" }, body: sseBody });
    }) as unknown as typeof fetch;

    const result = await sendMcpRequest("tools/list", {}, { endpointUrl: "https://example.com/mcp" });
    expect(result).toEqual({ ok: true });
  });

  it("throws McpTransportError when the event stream never includes a matching response", async () => {
    global.fetch = vi.fn(async () => mockResponse({ headers: { "content-type": "text/event-stream" }, body: "event: ping\n\n" })) as unknown as typeof fetch;
    await expect(sendMcpRequest("tools/list", {}, { endpointUrl: "https://example.com/mcp" })).rejects.toThrow(McpTransportError);
  });

  it("throws McpTransportError on a JSON-RPC error result", async () => {
    global.fetch = vi.fn(async (_url, opts) => {
      const body = JSON.parse((opts as RequestInit).body as string) as { id: string };
      return mockResponse({
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32000, message: "boom" } }),
      });
    }) as unknown as typeof fetch;
    await expect(sendMcpRequest("tools/list", {}, { endpointUrl: "https://example.com/mcp" })).rejects.toThrow(/boom/);
  });

  it("throws McpTransportError on a non-2xx HTTP status", async () => {
    global.fetch = vi.fn(async () => mockResponse({ status: 500, headers: { "content-type": "text/plain" }, body: "server error" })) as unknown as typeof fetch;
    await expect(sendMcpRequest("tools/list", {}, { endpointUrl: "https://example.com/mcp" })).rejects.toThrow(McpTransportError);
  });
});
