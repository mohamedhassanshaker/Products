import { describe, expect, it } from "vitest";
import { FakeSkillRepository, skillRowFixture } from "../testing/fakes.js";
import { DeleteSkill } from "./delete-skill.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("deleting a skill", () => {
  it("soft-deletes a skill with no active bindings", async () => {
    const skills = new FakeSkillRepository();
    skills.seed(skillRowFixture({ id: "skill_a" }));
    const del = new DeleteSkill({ skills });

    const result = await del.execute({ id: "skill_a", now: NOW });

    expect(result).toEqual({ ok: true });
    expect(await skills.get("skill_a")).toBeNull();
  });

  it("refuses, naming the bound agent versions, when the skill is still in use", async () => {
    const skills = new FakeSkillRepository();
    skills.seed(skillRowFixture({ id: "skill_a" }));
    skills.blockDelete("skill_a", ["agentver_1", "agentver_2"]);
    const del = new DeleteSkill({ skills });

    const result = await del.execute({ id: "skill_a", now: NOW });

    expect(result).toEqual({
      ok: false,
      reason: "tools.skill_in_use",
      boundAgentVersionIds: ["agentver_1", "agentver_2"],
    });
    expect(await skills.get("skill_a")).not.toBeNull();
  });
});
