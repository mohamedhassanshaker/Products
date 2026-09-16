import { describe, expect, it } from "vitest";
import { FakeRoleRepository } from "../testing/fakes.js";
import { CreateCustomRole } from "./create-custom-role.js";

describe("creating a custom role", () => {
  it("appends a role with isSystem: false, visible in the role list", async () => {
    const roles = new FakeRoleRepository();
    const create = new CreateCustomRole({ roles });

    const { role } = await create.execute({
      displayName: "Escalation Lead",
      description: "Owns the live queue during business hours.",
      createdByStaffUserId: "usr_01JBADMIN",
    });

    expect(role.isSystem).toBe(false);
    expect(await roles.list()).toEqual([role]);
  });

  it("starts with every permission off", async () => {
    // FakeRoleRepository.permissionMatrix() lists every live role, including
    // one with no grants at all, as an empty array rather than omitting it —
    // asserted against that exact behaviour rather than guessed.
    const roles = new FakeRoleRepository();
    const create = new CreateCustomRole({ roles });

    const { role } = await create.execute({
      displayName: "Escalation Lead",
      createdByStaffUserId: "usr_01JBADMIN",
    });

    expect((await roles.permissionMatrix())[role.key]).toEqual([]);
  });
});
