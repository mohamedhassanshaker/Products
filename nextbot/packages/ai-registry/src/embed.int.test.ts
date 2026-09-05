import { afterEach, describe, expect, it } from "vitest";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { embed } from "./embed.js";

describe("embed (LLD §7.1 embed.knowledge logical name)", () => {
  let server: MockOpenAiServerHandle | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns the provider's embedding vector", async () => {
    server = await startMockOpenAiCompatibleServer({ onEmbedding: () => ({ embedding: [1, 2, 3] }) });
    const vector = await embed({ input: "hello", chain: [{ providerKey: "openai-compatible", model: "test-embed", baseUrl: server.url }] });
    expect(vector).toEqual([1, 2, 3]);
  });

  it("advances past a failing first chain entry to a working second one", async () => {
    server = await startMockOpenAiCompatibleServer({ onEmbedding: () => ({ embedding: [4, 5, 6] }) });
    const vector = await embed({
      input: "hello",
      chain: [
        { providerKey: "openai-compatible", model: "unreachable", baseUrl: "http://127.0.0.1:1" },
        { providerKey: "openai-compatible", model: "test-embed", baseUrl: server.url },
      ],
    });
    expect(vector).toEqual([4, 5, 6]);
  });
});
