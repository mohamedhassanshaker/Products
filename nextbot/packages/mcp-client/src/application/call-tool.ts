import { sendMcpRequest, type StreamableHttpOptions } from "../infrastructure/streamable-http-transport.js";
import { validateAgainstJsonSchema } from "../schema/ajv-validator.js";

export class ToolArgsInvalidError extends Error {
  constructor(readonly errors: string[]) {
    super(`Tool call arguments failed schema validation: ${errors.join("; ")}`);
    this.name = "ToolArgsInvalidError";
  }
}

export class ToolResultInvalidError extends Error {
  constructor(readonly errors: string[]) {
    super(`Tool call result failed schema validation: ${errors.join("; ")}`);
    this.name = "ToolResultInvalidError";
  }
}

/**
 * Calls an MCP tool (`tools/call`), validating both the outbound arguments against
 * the tool's `input_schema` and the returned result against its `output_schema`
 * (LLD §1.1 — both directions get Ajv validation, since a discovered schema is
 * arbitrary third-party JSON Schema). Runs only inside `apps/gateway` (ADR-0004);
 * `apps/runtime` reaches this through `ports/egress.ts`, never directly.
 *
 * @throws {ToolArgsInvalidError} args don't match `inputSchema`.
 * @throws {ToolResultInvalidError} the tool's response doesn't match `outputSchema`.
 * @throws {McpTransportError} (from the transport layer) on any network/protocol failure.
 */
export async function callTool(
  toolName: string,
  args: unknown,
  schemas: { inputSchema: object; outputSchema?: object },
  opts: StreamableHttpOptions,
): Promise<unknown> {
  const argsCheck = validateAgainstJsonSchema(schemas.inputSchema, args);
  if (!argsCheck.valid) throw new ToolArgsInvalidError(argsCheck.errors);

  const result = await sendMcpRequest("tools/call", { name: toolName, arguments: args }, opts);

  if (schemas.outputSchema) {
    const resultCheck = validateAgainstJsonSchema(schemas.outputSchema, result);
    if (!resultCheck.valid) throw new ToolResultInvalidError(resultCheck.errors);
  }
  return result;
}
