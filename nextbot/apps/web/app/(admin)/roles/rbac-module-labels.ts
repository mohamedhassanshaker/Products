import { RBAC_MODULES, type RbacModuleValue } from "@nextbot/contracts";

/**
 * Human-readable labels for each `RbacModuleValue` (LLD §3.3 `RbacModule` /
 * FR-ADM-02's per-module permission matrix). Kept UI-only (not part of
 * `@nextbot/contracts`, which only owns the machine-readable enum) since this is
 * display copy, not a validated schema shape.
 */
export const RBAC_MODULE_LABELS: Record<RbacModuleValue, string> = {
  channels: "Channel Config",
  connectors: "Connector Config",
  tool_permissions: "Tool Permissions",
  agent_tool_config: "Agent Tool Config",
  approval_queue: "Approval Queue",
  escalations: "Escalations",
  conversations: "Conversations",
  reporting: "Reporting",
  a2a_config: "A2A Config",
  agent_platform: "Agent Platform",
  designer: "Designer (Conversation Studio)",
  security_settings: "Security Settings",
  audit_log: "Audit Log",
  users_roles: "Users & Roles",
  developer_portal: "Developer Portal",
  knowledge: "Knowledge (Collections & Sources)",
  knowledge_config: "Knowledge Config (Embedding/Chunking)",
};

/** Row order for the permission-matrix editor — `RBAC_MODULES`' own declared order
 * (the same order `domain/system-roles.ts` seeds every system role's matrix in). */
export const RBAC_MODULE_ORDER: RbacModuleValue[] = [...RBAC_MODULES];
