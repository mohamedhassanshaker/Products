import { describe, expect, it } from "vitest";
import { FakeSkillRepository } from "../testing/fakes.js";
import { CreateNativeSkill } from "./create-native-skill.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("creating a native skill", () => {
  it("appends a skill visible in the catalogue, with a derived key", async () => {
    const skills = new FakeSkillRepository();
    const create = new CreateNativeSkill({ skills });

    const { skill } = await create.execute({
      name: "Book Jawaher Centre slot",
      description: "Books a citizen into an available Jawaher Centre appointment slot.",
      category: "Bookings",
      inputSchemaJson: "{}",
      outputSchemaJson: null,
      isAttachedByDefault: false,
      now: NOW,
    });

    expect(skill.name).toBe("Book Jawaher Centre slot");
    expect(skill.key).toBe("book_jawaher_centre_slot");
    expect(skill.invocationKind).toBe("Native");
    expect(skill.isSystem).toBe(false);
    expect(skill.isAttachedByDefault).toBe(false);
    expect(await skills.list()).toEqual([skill]);
  });

  it("disambiguates the key when the derived slug is already taken", async () => {
    const skills = new FakeSkillRepository();
    const create = new CreateNativeSkill({ skills });

    await create.execute({
      name: "Escalate to live agent",
      description: null,
      category: null,
      inputSchemaJson: "{}",
      outputSchemaJson: null,
      isAttachedByDefault: true,
      now: NOW,
    });
    const { skill } = await create.execute({
      name: "Escalate to live agent",
      description: null,
      category: null,
      inputSchemaJson: "{}",
      outputSchemaJson: null,
      isAttachedByDefault: true,
      now: NOW,
    });

    expect(skill.key).toBe("escalate_to_live_agent_2");
  });
});
