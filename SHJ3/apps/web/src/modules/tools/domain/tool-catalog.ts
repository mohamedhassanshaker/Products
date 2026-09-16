/**
 * Enums for the shared tools/MCP catalogue — B3 step 4's three sub-tabs and B5 tabs 1-3.
 *
 * Transcribed directly from the real CHECK constraints in `prisma/sql/001_constraints.sql`
 * (confirmed by dedicated research before writing this file, not guessed — see
 * `tasks/todo.md`'s B-3 review). Pure domain: no vendor imports (architecture.md §4).
 */

/** `CK_Skills_invocationKind`. */
export const SKILL_INVOCATION_KINDS = ["Native", "ApiConnector", "McpTool"] as const;
export type SkillInvocationKind = (typeof SKILL_INVOCATION_KINDS)[number];
export function isSkillInvocationKind(value: string): value is SkillInvocationKind {
  return (SKILL_INVOCATION_KINDS as readonly string[]).includes(value);
}

/** `CK_McpServers_transport`. */
export const MCP_TRANSPORTS = ["Stdio", "Sse", "StreamableHttp"] as const;
export type McpTransport = (typeof MCP_TRANSPORTS)[number];
export function isMcpTransport(value: string): value is McpTransport {
  return (MCP_TRANSPORTS as readonly string[]).includes(value);
}

/** `CK_McpServers_authMode`. */
export const MCP_AUTH_MODES = ["OAuth2ClientCredentials", "MutualTls", "ApiKey", "None"] as const;
export type McpAuthMode = (typeof MCP_AUTH_MODES)[number];
export function isMcpAuthMode(value: string): value is McpAuthMode {
  return (MCP_AUTH_MODES as readonly string[]).includes(value);
}

/** `CK_McpServers_connectionState`. */
export const MCP_CONNECTION_STATES = ["NotConnected", "Connected", "Failed"] as const;
export type McpConnectionState = (typeof MCP_CONNECTION_STATES)[number];
export function isMcpConnectionState(value: string): value is McpConnectionState {
  return (MCP_CONNECTION_STATES as readonly string[]).includes(value);
}

/**
 * `ApiConnectors.authMode` carries **no CHECK constraint at all** (confirmed absent from
 * `001_constraints.sql` — a real, flagged gap, see `tasks/todo.md`). Validated at this
 * layer only. Mirrors `McpAuthMode`'s vocabulary minus `MutualTls` (not shown for
 * connectors anywhere in the wireframe, which lists only "API key" and "OAuth2 · client
 * credentials" rows), since both represent "how do we authenticate to an external
 * endpoint" and there is no reason to invent a second spelling of the same concept.
 */
export const API_CONNECTOR_AUTH_MODES = ["OAuth2ClientCredentials", "ApiKey", "None"] as const;
export type ApiConnectorAuthMode = (typeof API_CONNECTOR_AUTH_MODES)[number];
export function isApiConnectorAuthMode(value: string): value is ApiConnectorAuthMode {
  return (API_CONNECTOR_AUTH_MODES as readonly string[]).includes(value);
}

/** `CK_ApiConnectors_method`. */
export const API_CONNECTOR_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
export type ApiConnectorMethod = (typeof API_CONNECTOR_METHODS)[number];
export function isApiConnectorMethod(value: string): value is ApiConnectorMethod {
  return (API_CONNECTOR_METHODS as readonly string[]).includes(value);
}

/** `CK_ApiConnectors_testState`. */
export const API_CONNECTOR_TEST_STATES = ["Untested", "Tested", "Failed"] as const;
export type ApiConnectorTestState = (typeof API_CONNECTOR_TEST_STATES)[number];
export function isApiConnectorTestState(value: string): value is ApiConnectorTestState {
  return (API_CONNECTOR_TEST_STATES as readonly string[]).includes(value);
}

/** `CK_ToolBindings_targetKind`. */
export const TOOL_BINDING_TARGET_KINDS = ["Skill", "McpTool", "ApiConnector"] as const;
export type ToolBindingTargetKind = (typeof TOOL_BINDING_TARGET_KINDS)[number];
export function isToolBindingTargetKind(value: string): value is ToolBindingTargetKind {
  return (TOOL_BINDING_TARGET_KINDS as readonly string[]).includes(value);
}

/** `CK_ToolBindings_requiredAssurance`. */
export const REQUIRED_ASSURANCE_LEVELS = [
  "Anonymous",
  "Verified",
  "VerifiedPlusOtp",
  "VerifiedPlusDocument",
] as const;
export type RequiredAssuranceLevel = (typeof REQUIRED_ASSURANCE_LEVELS)[number];
export function isRequiredAssuranceLevel(value: string): value is RequiredAssuranceLevel {
  return (REQUIRED_ASSURANCE_LEVELS as readonly string[]).includes(value);
}

/** `CK_RateLimitPolicies_scope`. */
export const RATE_LIMIT_SCOPES = [
  "PerTenant",
  "PerConversation",
  "PerCitizen",
  "PerAgent",
] as const;
export type RateLimitScope = (typeof RATE_LIMIT_SCOPES)[number];
export function isRateLimitScope(value: string): value is RateLimitScope {
  return (RATE_LIMIT_SCOPES as readonly string[]).includes(value);
}
