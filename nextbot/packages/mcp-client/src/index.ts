// PUBLIC API for "@nextbot/mcp-client" (LLD §1.1, §5.4).
export { sendMcpRequest, McpTransportError, type StreamableHttpOptions } from "./infrastructure/streamable-http-transport.js";
export { listTools, type McpToolDescriptor } from "./application/list-tools.js";
export { listResources, type McpResourceDescriptor } from "./application/list-resources.js";
export { listPrompts, type McpPromptDescriptor, type McpPromptArgumentDescriptor } from "./application/list-prompts.js";
export { callTool, ToolArgsInvalidError, ToolResultInvalidError } from "./application/call-tool.js";
export {
  isBreakerOpen,
  recordBreakerOutcome,
  resetBreaker,
  getBreakerStatus,
  listBreakerStatuses,
  __resetBreakerStateForTests,
  BREAKER_TRIP_THRESHOLD,
  BREAKER_COOLDOWN_MS,
  type BreakerState,
  type BreakerStatus,
} from "./application/circuit-breaker.js";
export { _resetBreakerRedisClientForTests } from "./application/redis-client.js";
export { validateAgainstJsonSchema, type ValidationOutcome } from "./schema/ajv-validator.js";
