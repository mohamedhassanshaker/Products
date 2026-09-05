// PUBLIC API for @nextbot/tool-registry (LLD §2.2, BL-03).
export {
  resolvePermission,
  type ResolverTool,
  type ResolverConnector,
  type ResolverRule,
  type ResolverContext,
} from "./domain/permission-resolver.js";
export { classifyReadWrite, defaultApprovalTier } from "./domain/backend-type-defaults.js";
export { discoverAndSyncTools, listCatalog, type DiscoverySyncResult } from "./application/catalog-service.js";
export { getToolRules, updateToolRules, simulatePermission, resolveToolPermission } from "./application/permission-service.js";
export {
  findToolById,
  findToolByName,
  listTools,
  findCurrentSchemaVersion,
  upsertToolFromDiscovery,
  setToolCapabilityGroup,
  type ToolRow,
  type ToolSchemaVersionRow,
  // Target Architecture Blueprint Phase 14 (BL-46, FR-ORC-01, LLD §14.7.1) — the
  // catalog-side persistence for an agent-as-tool entry. `@nextbot/teams`'
  // `agent-tool-registrar.ts` is the only caller; the naming/tier-derivation
  // policy lives there, deliberately, so this module stays "the tool catalog" and
  // does not grow an opinion about teams.
  upsertAgentAsTool,
  retireAgentAsTool,
  AGENT_AS_TOOL_INPUT_SCHEMA,
  AGENT_AS_TOOL_OUTPUT_SCHEMA,
  type UpsertAgentAsToolInput,
} from "./infrastructure/tool-repository.js";
export {
  listCapabilityGroups,
  createCapabilityGroup,
  listCapabilityGroupsWithToolCounts,
  resolveCapabilityGroupIdsByNames,
  type CapabilityGroupRow,
  type CapabilityGroupWithToolCount,
} from "./infrastructure/capability-group-repository.js";
export {
  handleListTools,
  handleGetTool,
  handleDiscoverAndSync,
  handleSetVisibility,
  handleSetPriorityWeight,
  handleSetCapabilityGroup,
  handleListCapabilityGroups,
  handleListCapabilityGroupsWithToolCounts,
  handleCreateCapabilityGroup,
  handleUpdateCapabilityGroup,
  handleDeleteCapabilityGroup,
  handleCountToolsInCapabilityGroup,
  handleGetToolRules,
  handleUpdateToolRules,
  handleSimulatePermission,
} from "./http/admin-routes.js";

// Target Architecture Blueprint Phase 16 (BL-47b) — THE MCP egress implementation
// (ADR-0004). Moved here from `apps/gateway/src/lib/mcp-egress.ts` because a second
// composition root (`apps/worker`, hosting the workflow executor per ADR-0013 §7) now
// needs the same one; the gateway re-exports it so its behavior and its tests are
// unchanged. See `application/mcp-egress.ts`'s own doc comment for the full reasoning.
export { createMcpEgressPort, type McpEgressPort } from "./application/mcp-egress.js";
