import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import type { Role } from "../ports/role-repository.js";
import type { Team } from "../ports/team-repository.js";
import {
  FakeRoleRepository,
  FakeTeamRepository,
  FakeUserRepository,
  staffUserFixture,
} from "../testing/fakes.js";
import { ListUsers } from "./list-users.js";

/** B9 tab 1's roster, joined from three ports. */

const TENANT = "sewa" as TenantSlug;

const TEAM_ESCALATIONS: Team = {
  id: "team_escalations",
  name: "Escalations",
  scope: "Tenant",
  description: null,
  isSystem: false,
};

const ROLE_REVIEWER: Role = {
  id: "role_reviewer",
  key: "reviewer",
  displayName: "Reviewer",
  isSystem: true,
  ordinal: 4,
  description: null,
};

const ROLE_ANALYST: Role = {
  id: "role_analyst",
  key: "analyst",
  displayName: "Analyst",
  isSystem: true,
  ordinal: 6,
  description: null,
};

interface Harness {
  readonly list: ListUsers;
  readonly users: FakeUserRepository;
  readonly teams: FakeTeamRepository;
  readonly roles: FakeRoleRepository;
}

function harness(): Harness {
  const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
  const teams = new FakeTeamRepository();
  const roles = new FakeRoleRepository();
  roles.seed(ROLE_REVIEWER);
  roles.seed(ROLE_ANALYST);
  teams.seed(TEAM_ESCALATIONS);
  return { list: new ListUsers({ users, teams, roles }), users, teams, roles };
}

describe("listing B9 tab 1's roster", () => {
  it("joins the primary team name and role display names for a fully-assigned user", async () => {
    const h = harness();
    const user = staffUserFixture();
    h.users.seed({ user, roles: ["reviewer", "analyst"] });
    await h.teams.setMemberships(user.id, [TEAM_ESCALATIONS.id], "usr_01JBADMIN");

    const { rows } = await h.list.execute({ tenant: TENANT });

    expect(rows).toEqual([
      {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        status: "Active",
        primaryTeamName: "Escalations",
        roleDisplayNames: ["Reviewer", "Analyst"],
      },
    ]);
  });

  it("reports no primary team and no roles when the user has neither", async () => {
    const h = harness();
    h.users.seed({
      user: staffUserFixture({
        id: "usr_lonely",
        email: "lonely@shj.ae",
        displayName: "Lonely Newcomer",
      }),
      roles: [],
    });

    const { rows } = await h.list.execute({ tenant: TENANT });
    const row = rows.find((r) => r.id === "usr_lonely");

    expect(row?.primaryTeamName).toBeNull();
    expect(row?.roleDisplayNames).toEqual([]);
  });

  it("rosters only users with a live membership in this tenant", async () => {
    const h = harness();
    h.users.seed(
      { user: staffUserFixture({ id: "usr_elsewhere", email: "elsewhere@shj.ae" }), roles: [] },
      ["customs" as TenantSlug],
    );

    const { rows } = await h.list.execute({ tenant: TENANT });
    expect(rows.some((r) => r.id === "usr_elsewhere")).toBe(false);
  });
});
