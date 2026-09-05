/** RBAC domain types — ported verbatim (shape unchanged) from `legacy/api/src/modules/rbac/domain/rbac.types.ts`. */

export interface PermissionSummary {
  id: number;
  name: string;
  description: string | null;
  group: string;
}

export interface RoleSummary {
  id: number;
  name: string;
  description: string | null;
  isSystem: boolean;
  permissions: PermissionSummary[];
}

export interface CreateRoleInput {
  name: string;
  description?: string | null;
  permissionIds?: number[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
}
