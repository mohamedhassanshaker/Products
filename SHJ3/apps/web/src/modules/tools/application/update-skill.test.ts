import { describe, expect, it } from "vitest";
import { FakeSkillRepository, skillRowFixture } from "../testing/fakes.js";
import { UpdateSkill } from "./update-skill.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("updating a skill", () => {
  it("edits only the fields supplied, leaving the rest untouched", async () => {
    const skills = new FakeSkillRepository();
    skills.seed(skillRowFixture({ id: "skill_a", name: "Fetch SEWA bill", category: "Billing" }));
    const update = new UpdateSkill({ skills });

    await update.execute({ id: "skill_a", name: "Fetch SEWA bill (v2)", now: NOW });

    const skill = await skills.get("skill_a");
    expect(skill?.name).toBe("Fetch SEWA bill (v2)");
    expect(skill?.category).toBe("Billing");
  });

  it("clears a nullable field when explicitly passed null", async () => {
    const skills = new FakeSkillRepository();
    skills.seed(skillRowFixture({ id: "skill_a", description: "Old description" }));
    const update = new UpdateSkill({ skills });

    await update.execute({ id: "skill_a", description: null, now: NOW });

    expect((await skills.get("skill_a"))?.description).toBeNull();
  });

  it("is a no-op write when nothing is set", async () => {
    const skills = new FakeSkillRepository();
    const seeded = skillRowFixture({ id: "skill_a" });
    skills.seed(seeded);
    const update = new UpdateSkill({ skills });

    await update.execute({ id: "skill_a", now: NOW });

    expect(await skills.get("skill_a")).toEqual(seeded);
  });
});
