/**
 * Persist a batch of role-permission-matrix changes — B9 tab 3.
 *
 * This is the direct persistence hook `PermissionMatrix`'s `onCellsChange` /
 * `confirmChange` callbacks call (that wiring is a route file's job, not this
 * one's). Deliberately thin: the real logic — all-or-nothing application of
 * the batch, and detecting a revoke `TR_RolePermissions_protectSuperAdmin`
 * will refuse — lives in the adapter behind `RoleRepository.updatePermissions`,
 * per that port method's own doc comment. This use case exists only so the
 * route layer depends on the application layer rather than reaching into an
 * adapter directly (architecture.md's own layering rule) — it adds no logic
 * of its own, so there is no second place the all-or-nothing rule would have
 * to be kept correct.
 */

import type {
  RolePermissionChange,
  RoleRepository,
  UpdatePermissionsResult,
} from "../ports/role-repository.js";

export interface UpdateRolePermissionsInput {
  readonly changes: readonly RolePermissionChange[];
  readonly actorId: string;
}

/** Alias, not a redeclaration: the two-branch shape is owned by the port — see `UpdatePermissionsResult`'s own doc comment. */
export type UpdateRolePermissionsResult = UpdatePermissionsResult;

export interface UpdateRolePermissionsDeps {
  readonly roles: RoleRepository;
}

export class UpdateRolePermissions {
  constructor(private readonly deps: UpdateRolePermissionsDeps) {}

  async execute(input: UpdateRolePermissionsInput): Promise<UpdateRolePermissionsResult> {
    return this.deps.roles.updatePermissions(input.changes, input.actorId);
  }
}
