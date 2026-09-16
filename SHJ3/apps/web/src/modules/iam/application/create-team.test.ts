import { describe, expect, it } from "vitest";
import { FakeTeamRepository } from "../testing/fakes.js";
import { CreateTeam } from "./create-team.js";

describe("creating a team", () => {
  it("creates a team that then appears in the roster", async () => {
    const teams = new FakeTeamRepository();
    const create = new CreateTeam({ teams });

    const { team } = await create.execute({
      name: "Escalations",
      scope: "Tenant",
      description: "Handles the live queue.",
      createdByStaffUserId: "usr_01JBADMIN",
    });

    expect(team.name).toBe("Escalations");
    expect(await teams.list()).toEqual([team]);
  });

  it("does not reject an AllEntities-scoped team — that is a database trigger's job", async () => {
    // TR_Teams_crossEntityScope enforces this constraint at the database
    // layer; this use case and its fake have no opinion on it.
    const teams = new FakeTeamRepository();
    const create = new CreateTeam({ teams });

    const { team } = await create.execute({
      name: "Cross-entity escalations",
      scope: "AllEntities",
      createdByStaffUserId: "usr_01JBADMIN",
    });

    expect(team.scope).toBe("AllEntities");
  });
});
