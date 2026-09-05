import { afterEach, describe, expect, it } from "vitest";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { createOpenAiCompatibleClient } from "./openai-compatible.js";
import { ProviderCallError } from "./types.js";

/**
 * Real HTTP round trip against a local OpenAI-compatible stand-in — this is exactly
 * how ADR-0006 §2.2's "on-prem is first-class" is proven: this adapter has no idea
 * it isn't talking to a real Ollama/vLLM/LM Studio/OpenAI endpoint, since the
 * protocol is identical.
 */
describe("openai-compatible provider client (real HTTP, no live API key needed)", () => {
  let server: MockOpenAiServerHandle | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("sends the chat-completions request shape and parses a successful response", async () => {
    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: (body) => {
        expect(body.model).toBe("test-model");
        expect(body.messages).toEqual([
          { role: "system", content: "You are helpful." },
          { role: "user", content: "Hello" },
        ]);
        return { content: "Hi there!", promptTokens: 12, completionTokens: 4 };
      },
    });
    const client = createOpenAiCompatibleClient();
    const result = await client.generateText({
      model: "test-model",
      baseUrl: server.url,
      system: "You are helpful.",
      messages: [{ role: "user", content: "Hello" }],
      timeoutMs: 5000,
    });
    expect(result).toEqual({ text: "Hi there!", tokensIn: 12, tokensOut: 4 });
  });

  it("sends response_format.json_schema when a jsonSchema is requested", async () => {
    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: (body) => {
        expect(body.response_format).toEqual({
          type: "json_schema",
          json_schema: { name: "nextbot_structured_output", schema: { type: "object", properties: { ok: { type: "boolean" } } }, strict: true },
        });
        return { content: JSON.stringify({ ok: true }) };
      },
    });
    const client = createOpenAiCompatibleClient();
    const result = await client.generateText({
      model: "test-model",
      baseUrl: server.url,
      messages: [{ role: "user", content: "Hello" }],
      jsonSchema: { type: "object", properties: { ok: { type: "boolean" } } },
      timeoutMs: 5000,
    });
    expect(JSON.parse(result.text)).toEqual({ ok: true });
  });

  it("throws a retryable ProviderCallError on a 429", async () => {
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "", status: 429 }) });
    const client = createOpenAiCompatibleClient();
    await expect(
      client.generateText({ model: "test-model", baseUrl: server.url, messages: [{ role: "user", content: "hi" }], timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: "RateLimited", retryable: true });
  });

  it("throws a non-retryable ProviderCallError on a 400", async () => {
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "", status: 400 }) });
    const client = createOpenAiCompatibleClient();
    await expect(
      client.generateText({ model: "test-model", baseUrl: server.url, messages: [{ role: "user", content: "hi" }], timeoutMs: 5000 }),
    ).rejects.toMatchObject({ kind: "ClientError", retryable: false });
  });

  it("throws a Timeout ProviderCallError when the server is slower than the requested timeoutMs", async () => {
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "too slow" }), delayMs: 200 });
    const client = createOpenAiCompatibleClient();
    await expect(
      client.generateText({ model: "test-model", baseUrl: server.url, messages: [{ role: "user", content: "hi" }], timeoutMs: 20 }),
    ).rejects.toMatchObject({ kind: "Timeout", retryable: true });
  });

  it("round-trips a real embeddings call", async () => {
    server = await startMockOpenAiCompatibleServer({ onEmbedding: () => ({ embedding: [0.1, 0.2, 0.3], promptTokens: 3 }) });
    const client = createOpenAiCompatibleClient();
    const result = await client.embed({ model: "test-embed-model", baseUrl: server.url, input: "hello", timeoutMs: 5000 });
    expect(result).toEqual({ embedding: [0.1, 0.2, 0.3], tokensIn: 3 });
  });

  it("propagates ProviderCallError as an Error instance (not a plain object)", async () => {
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "", status: 500 }) });
    const client = createOpenAiCompatibleClient();
    try {
      await client.generateText({ model: "test-model", baseUrl: server.url, messages: [{ role: "user", content: "hi" }], timeoutMs: 5000 });
      expect.fail("expected a rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(ProviderCallError);
    }
  });
});
