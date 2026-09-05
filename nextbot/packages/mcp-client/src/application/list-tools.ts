import { sendMcpRequest, type StreamableHttpOptions } from "../infrastructure/streamable-http-transport.js";

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: object;
  outputSchema?: object;
}

interface ToolsListResult {
  tools: McpToolDescriptor[];
  nextCursor?: string;
}

/**
 * FR-MCP-01/02: calls the MCP server's `tools/list` method, following pagination via
 * `nextCursor` until exhausted. Transport failures propagate as `McpTransportError`
 * verbatim (FR-MCP-02's "surfaced verbatim" requirement) — this function adds no
 * generic wrapping.
 */
export async function listTools(opts: StreamableHttpOptions): Promise<McpToolDescriptor[]> {
  const all: McpToolDescriptor[] = [];
  let cursor: string | undefined;
  do {
    const result = (await sendMcpRequest("tools/list", cursor ? { cursor } : {}, opts)) as ToolsListResult;
    all.push(...(result.tools ?? []));
    cursor = result.nextCursor;
  } while (cursor);
  return all;
}
