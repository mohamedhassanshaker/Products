import { RBAC_MODULES, type PermissionMatrix, type PermissionLevelValue, type RbacModuleValue } from "@nextbot/contracts";

/** Builds a matrix granting `level` to `only` (default: all modules), None elsewhere. */
function matrix(overrides: Partial<Record<RbacModuleValue, PermissionLevelValue>>, fallback: PermissionLevelValue = "None"): PermissionMatrix {
  const result = {} as PermissionMatrix;
  for (const m of RBAC_MODULES) {
    result[m] = overrides[m] ?? fallback;
  }
  return result;
}

export interface SystemRoleDefinition {
  name: string;
  permissionMatrix: PermissionMatrix;
}

/**
 * The six system roles seeded per tenant (LLD §3.3 / this dispatch's brief). Every
 * module in `RbacModule` is given an explicit level — `PermissionMatrixSchema` is a
 * `Type.Record`, so a partial matrix would still validate, but seeding every key
 * explicitly avoids "undefined treated as None" ambiguity for the seeded defaults
 * specifically (application code still treats a missing key as None regardless, per
 * `hasAtLeast()`'s fail-closed default).
 */
export const SYSTEM_ROLES: readonly SystemRoleDefinition[] = [
  {
    name: "Tenant Admin",
    // Full control of the tenant's own configuration, incl. users/roles and security
    // settings; deliberately excludes nothing — this is the tenant's own root role.
    permissionMatrix: matrix({}, "Write"),
  },
  {
    name: "Backend System Owner",
    // Owns connector/tool configuration and the approval/escalation operational
    // surfaces; read-only on org-wide security/user administration.
    permissionMatrix: matrix({
      channels: "Write",
      connectors: "Write",
      tool_permissions: "Write",
      agent_tool_config: "Write",
      approval_queue: "Write",
      escalations: "Read",
      conversations: "Read",
      reporting: "Read",
      a2a_config: "Write",
      agent_platform: "Read",
      designer: "None",
      security_settings: "None",
      audit_log: "Read",
      users_roles: "None",
      developer_portal: "Read",
      // Phase 7b — visibility into what knowledge exists (relevant to connector-fed
      // sources), but not the model/chunking config a Platform Engineer owns.
      knowledge: "Read",
      knowledge_config: "None",
    }),
  },
  {
    name: "Designer",
    // Owns the Conversation Designer Studio / agent authoring surfaces; read-only on
    // live operational data.
    permissionMatrix: matrix({
      channels: "Read",
      connectors: "Read",
      tool_permissions: "Read",
      agent_tool_config: "Read",
      approval_queue: "None",
      escalations: "None",
      conversations: "Read",
      reporting: "Read",
      a2a_config: "None",
      agent_platform: "Write",
      designer: "Write",
      security_settings: "None",
      audit_log: "None",
      users_roles: "None",
      developer_portal: "Read",
      // Phase 7b — a Designer curates collections/sources as part of authoring
      // agents (Write), but changing the pinned embedding/rerank model or
      // chunking/extraction policy is a Platform Engineer concern (Read only) — the
      // exact "curator can add sources without changing retrieval behaviour" split
      // this module pair exists for.
      knowledge: "Write",
      knowledge_config: "Read",
    }),
  },
  {
    name: "Platform Engineer",
    // Owns Agent Platform (definitions, deployments, Model Gateway) and A2A config.
    permissionMatrix: matrix({
      channels: "Read",
      connectors: "Read",
      tool_permissions: "Read",
      agent_tool_config: "Read",
      approval_queue: "None",
      escalations: "None",
      conversations: "Read",
      reporting: "Read",
      a2a_config: "Write",
      agent_platform: "Write",
      designer: "Read",
      security_settings: "None",
      audit_log: "Read",
      users_roles: "None",
      developer_portal: "Write",
      // Phase 7b — owns the embedding/rerank model + chunking/extraction policy
      // config (same rationale as owning Model Gateway/Agent Platform), and can
      // also manage collections/sources directly.
      knowledge: "Write",
      knowledge_config: "Write",
    }),
  },
  {
    name: "Escalation Agent",
    // Human-in-the-loop takeover + approval decisions only.
    permissionMatrix: matrix({
      channels: "None",
      connectors: "None",
      tool_permissions: "None",
      agent_tool_config: "None",
      approval_queue: "Write",
      escalations: "Write",
      conversations: "Read",
      reporting: "None",
      a2a_config: "None",
      agent_platform: "None",
      designer: "None",
      security_settings: "None",
      audit_log: "None",
      users_roles: "None",
      developer_portal: "None",
      // Phase 7b — no authoring role for an escalation agent.
      knowledge: "None",
      knowledge_config: "None",
    }),
  },
  {
    name: "Read-Only",
    // Observability only — never Write anywhere.
    permissionMatrix: matrix({}, "Read"),
  },
];
