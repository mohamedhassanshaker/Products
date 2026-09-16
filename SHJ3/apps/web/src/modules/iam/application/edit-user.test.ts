import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import type { Team } from "../ports/team-repository.js";
import { FakeTeamRepository, FakeUserRepository, staffUserFixture } from "../testing/fakes.js";
import { EditUser } from "./edit-user.js";

/**
 * B9 tab 1's Edit dialog.
 *
 * Each of the four fields is tested in isolation first (proving the
 * independence the module comment claims), then all together, then with
 * none of them set at all — the no-op case a dialog's own "Save" button can
 * trigger just by being clicked with nothing changed.
 */

const TENANT = "sewa" as TenantSlug;

const TEAM_A: Team = {
  id: "team_a",
  name: "Escalations",
  scope: "Tenant",
  description: null,
  isSystem: false,
};
const TEAM_B: Team = {
  id: "team_b",
  name: "Knowledge",
  scope: "Tenant",
  description: null,
  isSystem: false,
};

interface Harness {
  readonly edit: EditUser;
  readonly users: FakeUserRepository;
  readonly teams: FakeTeamRepository;
}

function harness(): Harness {
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  const teams = new FakeTeamRepository();
  users.seed({ user: staffUserFixture(), roles: ["AgentDesigner"] });
  teams.seed(TEAM_A);
  teams.seed(TEAM_B);
  return { edit: new EditUser({ users, teams }), users, teams };
}

const BASE_INPUT = {
  staffUserId: "usr_01JBSARA",
  tenant: TENANT,
  actorId: "usr_01JBADMIN",
  environment: "production",
};

describe("editing a user", () => {
  it("edits only the display name", async () => {
    const h = harness();
    const { user } = await h.edit.execute({ ...BASE_INPUT, displayName: "Sara A. Mazrouei" });
    expect(user.displayName).toBe("Sara A. Mazrouei");
    expect(user.email).toBe(staffUserFixture().email);
  });

  it("edits only the email, and propagates a conflict with another live account", async () => {
    const h = harness();
    h.users.seed({
      user: staffUserFixture({ id: "usr_other", email: "other@shj.ae" }),
      roles: [],
    });

    await expect(h.edit.execute({ ...BASE_INPUT, email: "other@shj.ae" })).rejects.toThrow(
      /already in use/i,
    );
  });

  it("edits only the team pills", async () => {
    const h = harness();
    await h.edit.execute({ ...BASE_INPUT, teamIds: [TEAM_A.id, TEAM_B.id] });

    expect(await h.teams.listMemberships()).toEqual([
      { teamId: TEAM_A.id, staffUserId: BASE_INPUT.staffUserId, isPrimary: true },
      { teamId: TEAM_B.id, staffUserId: BASE_INPUT.staffUserId, isPrimary: false },
    ]);
  });

  it("edits only the role pills", async () => {
    const h = harness();
    await h.edit.execute({ ...BASE_INPUT, roleKeys: ["reviewer", "analyst"] });

    expect(await h.users.rolesFor(BASE_INPUT.staffUserId, TENANT)).toEqual(["reviewer", "analyst"]);
  });

  it("is a no-op, and returns the user unchanged, when nothing is set", async () => {
    const h = harness();
    const before = await h.users.findById(BASE_INPUT.staffUserId);
    const { user } = await h.edit.execute({ ...BASE_INPUT });
    expect(user).toEqual(before);
  });

  it("applies all four edits at once", async () => {
    const h = harness();
    const { user } = await h.edit.execute({
      ...BASE_INPUT,
      displayName: "Sara A. Mazrouei",
      email: "sara.a.mazrouei@shj.ae",
      teamIds: [TEAM_A.id],
      roleKeys: ["reviewer"],
    });

    expect(user.displayName).toBe("Sara A. Mazrouei");
    expect(user.email).toBe("sara.a.mazrouei@shj.ae");
    expect(await h.teams.listMemberships()).toEqual([
      { teamId: TEAM_A.id, staffUserId: BASE_INPUT.staffUserId, isPrimary: true },
    ]);
    expect(await h.users.rolesFor(BASE_INPUT.staffUserId, TENANT)).toEqual(["reviewer"]);
  });
});
