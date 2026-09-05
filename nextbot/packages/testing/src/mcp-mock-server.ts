import { createServer, type Server } from "node:http";

/**
 * A minimal in-process MCP server (Streamable HTTP transport) for unit/integration
 * tests — `packages/modules/connectors`' discovery-flow tests and
 * `packages/mcp-client`'s own tests both use this rather than hitting a real network
 * service. Understands `tools/list`, `tools/call`, `resources/list`, and
 * `prompts/list` (the last two added for BL-34's 9-step enrolment wizard, which
 * discovers all three MCP item kinds); anything else 404s with a JSON-RPC "method not
 * found" error, which is enough surface for this dispatch's test scope.
 */
export interface MockMcpTool {
  name: string;
  description?: string;
  inputSchema: object;
  outputSchema?: object;
  /** What `tools/call` returns for this tool, or a function to compute it from args. */
  result?: unknown | ((args: unknown) => unknown);
}

export interface MockMcpResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

export interface MockMcpPrompt {
  name: string;
  description?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean }>;
}

export interface MockMcpServerHandle {
  url: string;
  close: () => Promise<void>;
  /**
   * Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §6 item 6) — every JSON-RPC
   * request this server has received, in order.
   *
   * Added so shadow evaluation's tool-execution containment can be proven ADVERSARIALLY
   * rather than by code reading: a shadow replay of a candidate whose model output
   * selects a real write tool must leave this array with **zero** `tools/call` entries.
   * Asserting "the port returned a synthetic result" would only prove the port's own
   * return value; asserting that a real, listening MCP server was never contacted is the
   * property that actually matters.
   */
  receivedRequests: Array<{ method: string; params?: unknown }>;
  /** Test hook: BL-34's drift-review verification needs the *live* manifest to
   * change mid-test (simulating the tenant's real MCP server evolving) without
   * tearing down and restarting the mock server (which would change its port/url,
   * invalidating whatever `mcp_server`/`connector` row already points at it). */
  setTools: (tools: MockMcpTool[]) => void;
}

export async function startMockMcpServer(
  tools: MockMcpTool[],
  extras?: { resources?: MockMcpResource[]; prompts?: MockMcpPrompt[] },
): Promise<MockMcpServerHandle> {
  let currentTools = tools;
  const resources = extras?.resources ?? [];
  const prompts = extras?.prompts ?? [];

  const receivedRequests: Array<{ method: string; params?: unknown }> = [];

  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: { id: string; method: string; params?: { name?: string; arguments?: unknown; cursor?: string } };
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: "unknown", error: { code: -32700, message: "Parse error" } }));
        return;
      }

      receivedRequests.push({ method: body.method, params: body.params });

      if (body.method === "tools/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: body.id,
            result: { tools: currentTools.map(({ name, description, inputSchema, outputSchema }) => ({ name, description, inputSchema, outputSchema })) },
          }),
        );
        return;
      }

      if (body.method === "resources/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { resources } }));
        return;
      }

      if (body.method === "prompts/list") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { prompts } }));
        return;
      }

      if (body.method === "tools/call") {
        const tool = currentTools.find((t) => t.name === body.params?.name);
        if (!tool) {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32602, message: `Unknown tool ${body.params?.name}` } }));
          return;
        }
        const result = typeof tool.result === "function" ? (tool.result as (a: unknown) => unknown)(body.params?.arguments) : (tool.result ?? {});
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
        return;
      }

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: { code: -32601, message: `Method not found: ${body.method}` } }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    receivedRequests,
    close: () => new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
    setTools: (next: MockMcpTool[]) => {
      currentTools = next;
    },
  };
}
