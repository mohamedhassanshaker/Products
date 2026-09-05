import { sendMcpRequest, type StreamableHttpOptions } from "../infrastructure/streamable-http-transport.js";

export interface McpResourceDescriptor {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

interface ResourcesListResult {
  resources: McpResourceDescriptor[];
  nextCursor?: string;
}

/**
 * BL-34 (LLD §14.3.2's wizard step 4 discovery handshake, disclosed as deferred by
 * Phase 0's `mcp-registry` schema doc comment): calls the MCP server's
 * `resources/list` method, following pagination via `nextCursor` until exhausted —
 * mirrors `listTools`'s shape/error-propagation exactly, no generic wrapping of
 * transport failures (FR-MCP-02).
 */
export async function listResources(opts: StreamableHttpOptions): Promise<McpResourceDescriptor[]> {
  const all: McpResourceDescriptor[] = [];
  let cursor: string | undefined;
  do {
    const result = (await sendMcpRequest("resources/list", cursor ? { cursor } : {}, opts)) as ResourcesListResult;
    all.push(...(result.resources ?? []));
    cursor = result.nextCursor;
  } while (cursor);
  return all;
}
