import type { ApprovalTierValue } from "@nextbot/contracts";

/**
 * FR-MCP-13/LLD §3.6 "seeded backend-type defaults" heuristics, applied at tool
 * discovery time (`rw_class_source = AutoHeuristic`, `approval_tier_source =
 * BackendTypeDefault`). An admin can always override either via
 * `AdminOverride` — these are sensible starting points, not permanent constraints.
 */

const READ_VERBS = ["get", "list", "search", "find", "read", "view", "fetch", "lookup", "query"];
const DESTRUCTIVE_WRITE_VERBS = ["delete", "remove", "refund", "cancel", "void", "revoke", "terminate"];

/** Heuristic Read/Write classification from a tool's verbatim MCP name (snake_case
 * or camelCase, e.g. `get_ticket`, `createInvoice`). Defaults to `Write` when no
 * recognized verb is found — the conservative direction for an approval-tier system
 * (an unrecognized tool is treated as more sensitive, not less). */
export function classifyReadWrite(toolName: string): "Read" | "Write" {
  // Split BEFORE lowercasing — the camelCase boundary `(?=[A-Z])` only exists in the
  // original-cased string; lowercasing first would erase the very boundary this
  // split relies on.
  const firstToken = (toolName.split(/[_\-\s]|(?=[A-Z])/)[0] ?? toolName).toLowerCase();
  return READ_VERBS.includes(firstToken) ? "Read" : "Write";
}

/**
 * Seeded default approval tier (LLD §3.6):
 *   - Read on all backend types                          -> Tier1
 *   - Write on Billing                                    -> Tier2
 *   - Write on Ticketing/CRM/HRIS, destructive-shaped verb -> Tier2
 *   - Write on Ticketing/CRM/HRIS, otherwise (e.g. create) -> Tier1
 *   - Write on ERP/KnowledgeBase/Custom                    -> Tier2 (conservative
 *     default for backend types the LLD table didn't enumerate explicitly)
 */
export function defaultApprovalTier(backendType: string, rwClass: "Read" | "Write", toolName: string): ApprovalTierValue {
  if (rwClass === "Read") return "Tier1";

  if (backendType === "Billing") return "Tier2";

  const normalized = toolName.toLowerCase();
  const isDestructive = DESTRUCTIVE_WRITE_VERBS.some((verb) => normalized.includes(verb));

  if (backendType === "Ticketing" || backendType === "CRM" || backendType === "HRIS") {
    return isDestructive ? "Tier2" : "Tier1";
  }

  return "Tier2";
}
