import { randomUUID } from "node:crypto";
import { buildRequest, type JsonRpcResponse } from "../domain/jsonrpc.js";

/** FR-MCP-02: transport-level failures are surfaced verbatim (message text, no
 * generic wrapping) so the Admin Console can show the caller exactly what the
 * upstream MCP server / network layer said. */
export class McpTransportError extends Error {
  constructor(message: string, override readonly cause?: unknown) {
    super(message);
    this.name = "McpTransportError";
  }
}

export interface StreamableHttpOptions {
  endpointUrl: string;
  /** Auth headers already resolved from the connector's credential (built by the
   * caller — this transport never touches `SecretsProvider` itself). */
  headers?: Record<string, string>;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Sends a single JSON-RPC request over the MCP **Streamable HTTP** transport (a
 * single POST endpoint; the response is either a direct `application/json` body or a
 * `text/event-stream` carrying one or more JSON-RPC messages, per the MCP spec).
 *
 * Scoped simplification for this dispatch: no session-id negotiation / SSE
 * resumption / server-initiated push handling — every call is a stateless
 * request/response round trip, which covers `initialize`/`tools/list`/`tools/call`.
 * A connector whose server *requires* a long-lived session stream is out of scope
 * here (flagged, not silently unsupported: `apps/gateway` is the only caller and can
 * add session support without changing this function's external contract).
 */
export async function sendMcpRequest(
  method: string,
  params: unknown,
  opts: StreamableHttpOptions,
): Promise<unknown> {
  const id = randomUUID();
  const request = buildRequest(method, params, id);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(opts.endpointUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        ...opts.headers,
      },
      body: JSON.stringify(request),
      signal: controller.signal,
    });
  } catch (cause) {
    throw new McpTransportError(`Failed to reach MCP server at ${opts.endpointUrl}: ${(cause as Error).message}`, cause);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new McpTransportError(`MCP server returned HTTP ${response.status} ${response.statusText}: ${bodyText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const rpcResponse = contentType.includes("text/event-stream")
    ? await parseSseForResponse(response, id)
    : ((await response.json()) as JsonRpcResponse);

  if (rpcResponse.error) {
    throw new McpTransportError(`MCP error ${rpcResponse.error.code}: ${rpcResponse.error.message}`);
  }
  return rpcResponse.result;
}

/** Reads an SSE body looking for the `data:` frame whose JSON-RPC `id` matches ours. */
async function parseSseForResponse(response: Response, expectedId: string): Promise<JsonRpcResponse> {
  const text = await response.text();
  const events = text.split("\n\n").filter((chunk) => chunk.trim().length > 0);
  for (const event of events) {
    const dataLines = event
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());
    if (dataLines.length === 0) continue;
    try {
      const parsed = JSON.parse(dataLines.join("\n")) as JsonRpcResponse;
      if (parsed.id === expectedId) return parsed;
    } catch {
      // Not a JSON-RPC data frame (e.g. a keep-alive comment) — skip it.
      continue;
    }
  }
  throw new McpTransportError("MCP server's event stream never included a response for this request.");
}
