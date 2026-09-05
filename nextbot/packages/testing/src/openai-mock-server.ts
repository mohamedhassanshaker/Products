import { createServer, type Server } from "node:http";

/**
 * A minimal in-process stand-in for an OpenAI-compatible chat/completions +
 * embeddings endpoint — used by `packages/ai-registry`'s tests to exercise the real
 * `openai-compatible` provider adapter's HTTP round trip (request shape, structured-
 * output `response_format`, error-status mapping) without a live API key, in exactly
 * the same spirit as `startMockMcpServer` stands in for a real MCP server. Pointing
 * `AI_BASE_URL` / a `model_route.chain` entry's `baseUrl` at this server's `url` is
 * also how "on-prem is first-class" (ADR-0006 §2.2) is proven structurally: this
 * server is indistinguishable, protocol-wise, from a real Ollama/vLLM/LM Studio
 * instance as far as the adapter is concerned.
 */
export interface MockOpenAiResponder {
  /** Return a chat-completion response, or throw to simulate a transport failure. */
  onChatCompletion?: (body: { model: string; messages: Array<{ role: string; content: string }>; response_format?: unknown }) => {
    content: string;
    promptTokens?: number;
    completionTokens?: number;
    status?: number;
  };
  onEmbedding?: (body: { model: string; input: string }) => { embedding: number[]; promptTokens?: number; status?: number };
  /** Artificial per-request delay (ms) — used to exercise client-side timeout handling. */
  delayMs?: number;
}

export interface MockOpenAiServerHandle {
  url: string;
  close: () => Promise<void>;
}

export async function startMockOpenAiCompatibleServer(responder: MockOpenAiResponder): Promise<MockOpenAiServerHandle> {
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      if (responder.delayMs) {
        await new Promise((resolve) => setTimeout(resolve, responder.delayMs));
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "invalid json" } }));
        return;
      }

      if (req.url?.startsWith("/chat/completions")) {
        try {
          const result = responder.onChatCompletion?.(
            body as { model: string; messages: Array<{ role: string; content: string }>; response_format?: unknown },
          ) ?? { content: "" };
          res.writeHead(result.status ?? 200, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              choices: [{ message: { content: result.content } }],
              usage: { prompt_tokens: result.promptTokens ?? 1, completion_tokens: result.completionTokens ?? 1 },
            }),
          );
        } catch (err) {
          res.writeHead(500, { "content-type": "application/json" });
          res.end(JSON.stringify({ error: { message: (err as Error).message } }));
        }
        return;
      }

      if (req.url?.startsWith("/embeddings")) {
        const result = responder.onEmbedding?.(body as { model: string; input: string }) ?? { embedding: [] };
        res.writeHead(result.status ?? 200, { "content-type": "application/json" });
        res.end(JSON.stringify({ data: [{ embedding: result.embedding }], usage: { prompt_tokens: result.promptTokens ?? 1 } }));
        return;
      }

      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { message: "not found" } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}
