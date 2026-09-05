import { ForbiddenModuleError, PERMISSION_RANK, type PermissionLevelValue, type PermissionMatrix, type RbacModuleValue } from "@nextbot/contracts";

/**
 * Pure RBAC evaluation (LLD §3.3 `PermissionMatrixSchema`). A user's *effective*
 * matrix is the highest level granted by any of their assigned roles per module
 * (union-of-roles, not intersection) — a user with both "Read-Only" and
 * "Tenant Admin" roles gets Tenant Admin's Write, not Read-Only's Read.
 */
export function mergePermissionMatrices(matrices: PermissionMatrix[]): PermissionMatrix {
  const result = {} as PermissionMatrix;
  for (const matrix of matrices) {
    for (const [module, level] of Object.entries(matrix) as Array<[RbacModuleValue, PermissionLevelValue]>) {
      const current = result[module];
      if (current === undefined || PERMISSION_RANK[level] > PERMISSION_RANK[current]) {
        result[module] = level;
      }
    }
  }
  return result;
}

/** True if `matrix[module]` is at least `required` (None < Read < Write). */
export function hasAtLeast(
  matrix: PermissionMatrix,
  module: RbacModuleValue,
  required: PermissionLevelValue,
): boolean {
  const level = matrix[module] ?? "None";
  return PERMISSION_RANK[level] >= PERMISSION_RANK[required];
}

/**
 * The RBAC guard (LLD: "requirePermission(module, level) is enforced on a real
 * endpoint"). Fail-closed: an unknown/missing module entry defaults to `None`, never
 * to an implicit allow.
 *
 * @throws {ForbiddenModuleError} when the effective matrix does not grant `required`.
 */
export function requirePermission(
  matrix: PermissionMatrix,
  module: RbacModuleValue,
  required: PermissionLevelValue,
): void {
  if (!hasAtLeast(matrix, module, required)) {
    throw new ForbiddenModuleError(module, required);
  }
}
