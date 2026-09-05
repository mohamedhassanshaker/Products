import { afterEach, describe, expect, it } from "vitest";
import { Type } from "@sinclair/typebox";
import { StructuredOutputInvalidError, AllProvidersUnavailableError } from "@nextbot/contracts";
import { startMockOpenAiCompatibleServer, type MockOpenAiServerHandle } from "@nextbot/testing";
import { generateStructured, generateText } from "./structured.js";

const ToolSelectionSchema = Type.Object({ toolName: Type.String(), confidence: Type.Number() });

describe("generateStructured (LLD §7.2 — TypeBox re-validation, never hand-parsed JSON)", () => {
  let server: MockOpenAiServerHandle | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("returns the parsed+validated object when the model's first response conforms", async () => {
    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: () => ({ content: JSON.stringify({ toolName: "lookup_order", confidence: 0.92 }) }),
    });
    const result = await generateStructured({
      routeKey: "chat.primary",
      schema: ToolSelectionSchema,
      system: "Select a tool.",
      messages: [{ role: "user", content: "Where is my order?" }],
      chain: [{ providerKey: "openai-compatible", model: "test-model", baseUrl: server.url }],
    });
    expect(result).toEqual({ toolName: "lookup_order", confidence: 0.92 });
  });

  it("repairs once when the first response is schema-invalid, then succeeds", async () => {
    let callCount = 0;
    server = await startMockOpenAiCompatibleServer({
      onChatCompletion: () => {
        callCount += 1;
        if (callCount === 1) return { content: JSON.stringify({ toolName: "lookup_order" }) }; // missing `confidence`
        return { content: JSON.stringify({ toolName: "lookup_order", confidence: 0.5 }) };
      },
    });
    const result = await generateStructured({
      routeKey: "chat.primary",
      schema: ToolSelectionSchema,
      system: "Select a tool.",
      messages: [{ role: "user", content: "Where is my order?" }],
      chain: [{ providerKey: "openai-compatible", model: "test-model", baseUrl: server.url }],
    });
    expect(result).toEqual({ toolName: "lookup_order", confidence: 0.5 });
    expect(callCount).toBe(2);
  });

  it("throws StructuredOutputInvalidError (never a partial/coerced object) once the repair attempt also fails", async () => {
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: JSON.stringify({ toolName: "x" }) }) });
    await expect(
      generateStructured({
        routeKey: "chat.primary",
        schema: ToolSelectionSchema,
        system: "Select a tool.",
        messages: [{ role: "user", content: "hi" }],
        chain: [{ providerKey: "openai-compatible", model: "test-model", baseUrl: server.url }],
      }),
    ).rejects.toBeInstanceOf(StructuredOutputInvalidError);
  });

  it("throws StructuredOutputInvalidError when the response is not valid JSON at all", async () => {
    server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "not json at all" }) });
    await expect(
      generateStructured({
        routeKey: "chat.primary",
        schema: ToolSelectionSchema,
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        chain: [{ providerKey: "openai-compatible", model: "test-model", baseUrl: server.url }],
      }),
    ).rejects.toBeInstanceOf(StructuredOutputInvalidError);
  });

  it("propagates AllProvidersUnavailableError when the underlying chain is exhausted", async () => {
    await expect(
      generateStructured({
        routeKey: "chat.primary",
        schema: ToolSelectionSchema,
        system: "s",
        messages: [{ role: "user", content: "hi" }],
        chain: [{ providerKey: "openai-compatible", model: "test-model", baseUrl: "http://127.0.0.1:1" }],
        totalTimeoutMs: 500,
      }),
    ).rejects.toBeInstanceOf(AllProvidersUnavailableError);
  });
});

describe("generateText (plain completion path)", () => {
  it("returns the raw text without any JSON parsing", async () => {
    const server = await startMockOpenAiCompatibleServer({ onChatCompletion: () => ({ content: "Just some prose, not JSON." }) });
    try {
      const text = await generateText({
        routeKey: "summarize.escalation",
        messages: [{ role: "user", content: "Summarize this." }],
        chain: [{ providerKey: "openai-compatible", model: "test-model", baseUrl: server.url }],
      });
      expect(text).toBe("Just some prose, not JSON.");
    } finally {
      await server.close();
    }
  });
});
