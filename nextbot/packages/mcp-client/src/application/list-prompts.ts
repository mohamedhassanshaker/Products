import { sendMcpRequest, type StreamableHttpOptions } from "../infrastructure/streamable-http-transport.js";

export interface McpPromptArgumentDescriptor {
  name: string;
  description?: string;
  required?: boolean;
}

export interface McpPromptDescriptor {
  name: string;
  description?: string;
  arguments?: McpPromptArgumentDescriptor[];
}

interface PromptsListResult {
  prompts: McpPromptDescriptor[];
  nextCursor?: string;
}

/**
 * BL-34 companion to `listResources` — `prompts/list`, same pagination/error-
 * propagation shape as `listTools`/`listResources`.
 */
export async function listPrompts(opts: StreamableHttpOptions): Promise<McpPromptDescriptor[]> {
  const all: McpPromptDescriptor[] = [];
  let cursor: string | undefined;
  do {
    const result = (await sendMcpRequest("prompts/list", cursor ? { cursor } : {}, opts)) as PromptsListResult;
    all.push(...(result.prompts ?? []));
    cursor = result.nextCursor;
  } while (cursor);
  return all;
}
