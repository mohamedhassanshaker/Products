/**
 * Add a custom role — B9 tab 3's **+ Add custom role**: "appends a blank role
 * with every permission off."
 *
 * Thin by design, mirroring `create-team.ts`: `RoleRepository.createCustomRole`
 * owns the actual write, including deriving and disambiguating `key` from
 * `displayName` (that port method's own doc comment) — logic this use case
 * must not duplicate, or the two could disagree about what key a given
 * display name produces.
 */

import type { NewCustomRole, Role, RoleRepository } from "../ports/role-repository.js";

export interface CreateCustomRoleInput {
  readonly displayName: string;
  readonly description?: string;
  readonly createdByStaffUserId: string;
}

export interface CreateCustomRoleResult {
  readonly role: Role;
}

export interface CreateCustomRoleDeps {
  readonly roles: RoleRepository;
}

export class CreateCustomRole {
  constructor(private readonly deps: CreateCustomRoleDeps) {}

  async execute(input: CreateCustomRoleInput): Promise<CreateCustomRoleResult> {
    const newRole: NewCustomRole = {
      displayName: input.displayName,
      createdByStaffUserId: input.createdByStaffUserId,
      ...(input.description === undefined ? {} : { description: input.description }),
    };
    const role = await this.deps.roles.createCustomRole(newRole);
    return { role };
  }
}
