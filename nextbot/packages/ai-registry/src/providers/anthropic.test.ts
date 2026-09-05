import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createAnthropicClient } from "./anthropic.js";
import { ProviderCallError } from "./types.js";

/**
 * Anthropic's Messages API (`POST /v1/messages`) has no publicly reachable local
 * stand-in the way OpenAI-compatible does (no OSS server implements its exact wire
 * format) — this test stands up a minimal local server that speaks just enough of
 * that real, documented contract (`/v1/messages`, `content: [{type, text|input}]`,
 * `usage.{input,output}_tokens`) to exercise this adapter's real `@anthropic-ai/sdk`
 * call end-to-end (request shape, response parsing, error-status mapping), the same
 * way `openai-compatible.int.test.ts` does against the OpenAI-compatible protocol —
 * without needing a live `ANTHROPIC_API_KEY` credential, which this sandbox has none
 * of (see the dispatch report for the full rationale).
 */
function startMockAnthropicServer(handler: (body: Record<string, unknown>) => { status: number; body: Record<string, unknown> }): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      const { status, body: responseBody } = handler(body);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(responseBody));
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

describe("Anthropic provider client", () => {
  let server: { url: string; close: () => Promise<void> } | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("sends messages/system and parses a plain text response", async () => {
    server = await startMockAnthropicServer((body) => {
      expect(body.model).toBe("claude-test-model");
      expect(body.system).toBe("Be helpful.");
      expect(body.messages).toEqual([{ role: "user", content: "Hello" }]);
      return { status: 200, body: { content: [{ type: "text", text: "Hi!" }], usage: { input_tokens: 10, output_tokens: 3 } } };
    });
    const client = createAnthropicClient();
    const result = await client.generateText({
      model: "claude-test-model",
      baseUrl: server.url,
      apiKey: "test-key",
      system: "Be helpful.",
      messages: [{ role: "user", content: "Hello" }],
      timeoutMs: 5000,
    });
    expect(result).toEqual({ text: "Hi!", tokensIn: 10, tokensOut: 3 });
  });

  it("requests a forced tool_use when jsonSchema is provided, and returns the tool's input as JSON text", async () => {
    server = await startMockAnthropicServer((body) => {
      expect(body.tool_choice).toEqual({ type: "tool", name: "structured_output" });
      const tools = body.tools as Array<{ name: string; input_schema: unknown }>;
      expect(tools[0]?.name).toBe("structured_output");
      expect(tools[0]?.input_schema).toEqual({ type: "object", properties: { ok: { type: "boolean" } } });
      return {
        status: 200,
        body: {
          content: [{ type: "tool_use", id: "call_1", name: "structured_output", input: { ok: true } }],
          usage: { input_tokens: 20, output_tokens: 5 },
        },
      };
    });
    const client = createAnthropicClient();
    const result = await client.generateText({
      model: "claude-test-model",
      baseUrl: server.url,
      apiKey: "test-key",
      messages: [{ role: "user", content: "Hello" }],
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      timeoutMs: 5000,
    });
    expect(JSON.parse(result.text)).toEqual({ ok: true });
  });

  it("maps a 429 response to a retryable RateLimited ProviderCallError", async () => {
    server = await startMockAnthropicServer(() => ({ status: 429, body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } } }));
    const client = createAnthropicClient();
    await expect(
      client.generateText({ model: "m", baseUrl: server.url, apiKey: "k", messages: [{ role: "user", content: "hi" }], timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: "RateLimited", retryable: true });
  });

  it("maps a 400 response to a non-retryable ClientError ProviderCallError", async () => {
    server = await startMockAnthropicServer(() => ({ status: 400, body: { type: "error", error: { type: "invalid_request_error", message: "bad" } } }));
    const client = createAnthropicClient();
    await expect(
      client.generateText({ model: "m", baseUrl: server.url, apiKey: "k", messages: [{ role: "user", content: "hi" }], timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: "ClientError", retryable: false });
  });

  it("embed() fails loudly rather than returning a silent zero vector (Anthropic has no embeddings endpoint)", async () => {
    const client = createAnthropicClient();
    await expect(client.embed({ model: "m", input: "hi", timeoutMs: 1000 })).rejects.toBeInstanceOf(ProviderCallError);
  });
});
