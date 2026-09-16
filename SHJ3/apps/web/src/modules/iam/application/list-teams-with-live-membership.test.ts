import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import { SEEDED_ROLE_PERMISSIONS } from "../domain/permissions.js";
import type { Team } from "../ports/team-repository.js";
import { FakeTeamRepository, FakeUserRepository, staffUserFixture } from "../testing/fakes.js";
import { ListTeamsWithLiveMembership } from "./list-teams-with-live-membership.js";

const TENANT = "sewa" as TenantSlug;

const TEAM_ESCALATIONS: Team = {
  id: "team_escalations",
  name: "Escalations",
  scope: "Tenant",
  description: null,
  isSystem: false,
};
const TEAM_KNOWLEDGE: Team = {
  id: "team_knowledge",
  name: "Knowledge",
  scope: "Tenant",
  description: null,
  isSystem: false,
};

describe("listing B9 tab 2's roster with live membership", () => {
  it("reflects a membership change made after the first read, on the very next read", async () => {
    // This is the "derived live" guarantee the wireframe promises: nothing
    // here may be cached from the first execute() call.
    const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
    const teams = new FakeTeamRepository();
    teams.seed(TEAM_ESCALATIONS);
    teams.seed(TEAM_KNOWLEDGE);
    users.seed({ user: staffUserFixture(), roles: [] });
    users.seed({
      user: staffUserFixture({
        id: "usr_second",
        email: "second@shj.ae",
        displayName: "Second Person",
      }),
      roles: [],
    });

    await teams.setMemberships(staffUserFixture().id, [TEAM_ESCALATIONS.id], "usr_01JBADMIN");
    await teams.setMemberships("usr_second", [TEAM_ESCALATIONS.id], "usr_01JBADMIN");

    const list = new ListTeamsWithLiveMembership({ teams, users });
    const first = await list.execute({ tenant: TENANT });

    const escalationsFirst = first.rows.find((r) => r.team.id === TEAM_ESCALATIONS.id);
    expect(escalationsFirst?.memberCount).toBe(2);
    expect([...(escalationsFirst?.memberDisplayNames ?? [])].sort()).toEqual([
      "Sara Al Mazrouei",
      "Second Person",
    ]);

    await teams.setMemberships("usr_second", [TEAM_KNOWLEDGE.id], "usr_01JBADMIN");
    const second = await list.execute({ tenant: TENANT });

    const escalationsSecond = second.rows.find((r) => r.team.id === TEAM_ESCALATIONS.id);
    const knowledgeSecond = second.rows.find((r) => r.team.id === TEAM_KNOWLEDGE.id);
    expect(escalationsSecond?.memberCount).toBe(1);
    expect(escalationsSecond?.memberDisplayNames).toEqual(["Sara Al Mazrouei"]);
    expect(knowledgeSecond?.memberCount).toBe(1);
    expect(knowledgeSecond?.memberDisplayNames).toEqual(["Second Person"]);
  });

  it("skips a dangling staffUserId whose staff user cannot be found", async () => {
    const users = new FakeUserRepository(SEEDED_ROLE_PERMISSIONS);
    const teams = new FakeTeamRepository();
    teams.seed(TEAM_ESCALATIONS);
    users.seed({ user: staffUserFixture(), roles: [] });

    await teams.setMemberships(staffUserFixture().id, [TEAM_ESCALATIONS.id], "usr_01JBADMIN");
    await teams.setMemberships("usr_ghost", [TEAM_ESCALATIONS.id], "usr_01JBADMIN");

    const list = new ListTeamsWithLiveMembership({ teams, users });
    const { rows } = await list.execute({ tenant: TENANT });

    const row = rows.find((r) => r.team.id === TEAM_ESCALATIONS.id);
    expect(row?.memberCount).toBe(1);
    expect(row?.memberDisplayNames).toEqual(["Sara Al Mazrouei"]);
  });
});
