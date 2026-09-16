import { describe, expect, it } from "vitest";
import { ROLE_KEYS } from "../domain/permissions.js";
import type { Role } from "../ports/role-repository.js";
import { FakeRoleRepository } from "../testing/fakes.js";
import { UpdateRolePermissions } from "./update-role-permissions.js";

const SUPER_ADMIN_ROLE: Role = {
  id: "role_super_admin",
  key: ROLE_KEYS.SuperAdmin,
  displayName: "Super Admin",
  isSystem: true,
  ordinal: 0,
  description: null,
};

const REVIEWER_ROLE: Role = {
  id: "role_reviewer",
  key: "reviewer",
  displayName: "Reviewer",
  isSystem: true,
  ordinal: 4,
  description: null,
};

describe("updating the role-permission matrix", () => {
  it("applies a successful batch, visible in permissionMatrix() afterward", async () => {
    const roles = new FakeRoleRepository();
    roles.seed(REVIEWER_ROLE);
    const update = new UpdateRolePermissions({ roles });

    const result = await update.execute({
      changes: [{ roleKey: "reviewer", permission: "analytics:view", granted: true }],
      actorId: "usr_01JBADMIN",
    });

    expect(result.ok).toBe(true);
    expect((await roles.permissionMatrix())["reviewer"]).toEqual(["analytics:view"]);
  });

  it("returns the protected-cell shape when a batch would revoke super_admin's users:manage grant", async () => {
    // FakeRoleRepository.updatePermissions already implements
    // TR_RolePermissions_protectSuperAdmin's refusal; this drives it rather
    // than re-asserting the rule itself.
    const roles = new FakeRoleRepository();
    roles.seed(SUPER_ADMIN_ROLE);
    roles.grant(ROLE_KEYS.SuperAdmin, "users:manage");
    const update = new UpdateRolePermissions({ roles });

    const result = await update.execute({
      changes: [{ roleKey: ROLE_KEYS.SuperAdmin, permission: "users:manage", granted: false }],
      actorId: "usr_01JBADMIN",
    });

    expect(result).toEqual({
      ok: false,
      reason: "protected",
      roleKey: ROLE_KEYS.SuperAdmin,
      permission: "users:manage",
      message: expect.any(String),
    });
  });
});
