import type { PermissionLevelValue, PermissionMatrix, RbacModuleValue } from "@nextbot/contracts";

/**
 * RBAC-gated nav visibility rule (UX baseline §2: "hide on None, disabled+tooltip on
 * Read [for Write-only screens], full on Write"). Pure function so the admin shell's
 * nav-building logic is unit-testable without rendering.
 */
export interface NavRule {
  module: RbacModuleValue;
  required: PermissionLevelValue;
}

export function isNavItemVisible(matrix: PermissionMatrix, rule: NavRule): boolean {
  const level = matrix[rule.module] ?? "None";
  const rank: Record<PermissionLevelValue, number> = { None: 0, Read: 1, Write: 2 };
  return rank[level] >= rank[rule.required];
}

/**
 * Plan Phase 3 (client-feedback-batch, settings hub): visibility check for a nav
 * item that fans out to several RBAC modules at once — e.g. the collapsed
 * "Settings" nav entry, which links to screens gated on `security_settings`,
 * `escalations`, `agent_platform`, `users_roles`, and `audit_log` individually.
 * The item itself must be visible whenever the caller can read *any* of those
 * (matching each destination's own fail-closed gate) rather than requiring one
 * single representative module — a caller with only `escalations: "Read"` should
 * still see "Settings" and land on a hub with exactly one usable card, not be
 * denied the entry point entirely. A caller who can read none of them never sees
 * the entry, so it's never visible to someone who can't actually read anything
 * behind it.
 */
export function isAnyNavItemVisible(matrix: PermissionMatrix, rules: NavRule[]): boolean {
  return rules.some((rule) => isNavItemVisible(matrix, rule));
}
