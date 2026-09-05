/**
 * Minimal JSON-RPC 2.0 envelope types used by the MCP Streamable HTTP transport
 * (LLD §5.4). Kept intentionally small — only the request/response shapes this
 * client actually sends/receives, not a general-purpose JSON-RPC library.
 */
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params?: unknown;
}

export interface JsonRpcErrorBody {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string;
  result?: unknown;
  error?: JsonRpcErrorBody;
}

export function buildRequest(method: string, params: unknown, id: string): JsonRpcRequest {
  return { jsonrpc: "2.0", id, method, params };
}
