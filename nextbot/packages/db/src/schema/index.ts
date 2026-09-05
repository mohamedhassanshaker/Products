/**
 * The single Drizzle schema surface (LLD §2.2: "One Drizzle client factory, in
 * @nextbot/db; modules never construct their own"). Re-exports every table/enum so
 * `drizzle(client, { schema })` sees the whole graph, which Drizzle's relational
 * query API needs for join inference.
 */
export * from "./enums.js";
export * from "./domain-event.js";
export * from "./tenancy.js";
export * from "./iam.js";
export * from "./connectors.js";
export * from "./tool-registry.js";
export * from "./channels.js";
export * from "./conversations.js";
export * from "./agent-platform.js";
export * from "./approvals.js";
export * from "./escalations.js";
export * from "./audit.js";
export * from "./pii.js";
export * from "./whatsapp.js";
export * from "./platform-ops.js";
export * from "./mcp-registry.js";
export * from "./model-gateway.js";
export * from "./skills.js";
export * from "./authz.js";
export * from "./teams.js";
export * from "./knowledge.js";
export * from "./workflows.js";
export * from "./webhooks.js";
export * from "./telemetry-export.js";
