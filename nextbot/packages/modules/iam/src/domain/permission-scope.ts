import { ApiKeyScopeExceedsAccountError, PERMISSION_RANK, RBAC_MODULES, type PermissionLevelValue, type PermissionMatrix } from "@nextbot/contracts";

/**
 * Pure permission-scope-narrowing logic for service-account API keys (Phase 4,
 * BL-36, FR-SEC-10) — kept in `domain/` (no I/O) so it's directly unit-testable
 * without a database, per this project's "every non-trivial method gets direct
 * coverage" rule.
 */

/** Intersects a requested `scopeMatrix` against the account's own role-derived
 * matrix — a key can only narrow, never widen, what the account itself can do.
 * @throws {ApiKeyScopeExceedsAccountError} if any module's requested level
 *   exceeds the account's own effective level for that module. */
export function assertScopeWithinAccountMatrix(accountMatrix: PermissionMatrix, scope: PermissionMatrix): void {
  for (const module of RBAC_MODULES) {
    const requested = scope[module] ?? "None";
    const allowed = accountMatrix[module] ?? "None";
    if (PERMISSION_RANK[requested] > PERMISSION_RANK[allowed]) {
      throw new ApiKeyScopeExceedsAccountError();
    }
  }
}

/** The actual per-request enforcement: the effective matrix for a key is the
 * PER-MODULE MINIMUM of the account's role-derived matrix and the key's own
 * `scope_matrix` (or the account matrix unchanged if no scope was set) — never
 * the maximum, and never trusted from the scope alone without re-deriving the
 * account's live matrix on every call (see `service-account.ts`'s
 * `verifyApiKey`). */
export function intersectMatrices(accountMatrix: PermissionMatrix, scope: PermissionMatrix | null): PermissionMatrix {
  if (!scope) return accountMatrix;
  const result = {} as PermissionMatrix;
  for (const module of RBAC_MODULES) {
    const accountLevel = accountMatrix[module] ?? "None";
    const scopeLevel = scope[module] ?? "None";
    result[module] = (PERMISSION_RANK[accountLevel] <= PERMISSION_RANK[scopeLevel] ? accountLevel : scopeLevel) as PermissionLevelValue;
  }
  return result;
}
