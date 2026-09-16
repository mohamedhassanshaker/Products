import { describe, expect, it } from "vitest";
import {
  FakeSkillRepository,
  FakeToolBindingRepository,
  skillRowFixture,
} from "../testing/fakes.js";
import { ListSkills } from "./list-skills.js";

describe("listing the skills catalogue with live bind counts", () => {
  it("merges each skill with its enabled-binding count", async () => {
    const skills = new FakeSkillRepository();
    const bindings = new FakeToolBindingRepository();
    skills.seed(skillRowFixture({ id: "skill_a", name: "Fetch SEWA bill" }));
    skills.seed(skillRowFixture({ id: "skill_b", name: "Book Jawaher Centre slot" }));
    await bindings.bind({
      agentVersionId: "agentver_1",
      targetKind: "Skill",
      targetId: "skill_a",
      requiredAssurance: "Verified",
      actorStaffUserId: "usr_admin",
      now: new Date("2026-09-09T00:00:00.000Z"),
    });
    await bindings.bind({
      agentVersionId: "agentver_2",
      targetKind: "Skill",
      targetId: "skill_a",
      requiredAssurance: "Verified",
      actorStaffUserId: "usr_admin",
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    const list = new ListSkills({ skills, bindings });
    const { rows } = await list.execute();

    const rowA = rows.find((r) => r.id === "skill_a");
    const rowB = rows.find((r) => r.id === "skill_b");
    expect(rowA?.boundAgentVersionCount).toBe(2);
    expect(rowB?.boundAgentVersionCount).toBe(0);
  });

  it("defaults to zero for a skill with no entry in the counts map at all", async () => {
    const skills = new FakeSkillRepository();
    const bindings = new FakeToolBindingRepository();
    skills.seed(skillRowFixture({ id: "skill_unbound" }));

    const list = new ListSkills({ skills, bindings });
    const { rows } = await list.execute();

    expect(rows[0]?.boundAgentVersionCount).toBe(0);
  });

  it("reflects an unbind on the very next call — never cached", async () => {
    const skills = new FakeSkillRepository();
    const bindings = new FakeToolBindingRepository();
    skills.seed(skillRowFixture({ id: "skill_a" }));
    await bindings.bind({
      agentVersionId: "agentver_1",
      targetKind: "Skill",
      targetId: "skill_a",
      requiredAssurance: "Verified",
      actorStaffUserId: "usr_admin",
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    const list = new ListSkills({ skills, bindings });
    expect((await list.execute()).rows[0]?.boundAgentVersionCount).toBe(1);

    await bindings.unbind({
      agentVersionId: "agentver_1",
      targetKind: "Skill",
      targetId: "skill_a",
    });
    expect((await list.execute()).rows[0]?.boundAgentVersionCount).toBe(0);
  });
});
