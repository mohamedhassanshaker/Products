/**
 * Edit a skill's descriptive fields — B3 step 4 sub-tab A / B5 tab 1's Edit
 * dialog: name, description and category, each independently optional in the
 * same call, mirroring `iam`'s `edit-user.ts` shape for "several optional fields,
 * one port write." `SkillRepository.update` owns the actual write; this use case
 * only forwards whichever fields the caller actually supplied.
 */

import type { SkillRepository } from "../ports/skill-repository.js";

export interface UpdateSkillInput {
  readonly id: string;
  readonly name?: string;
  readonly description?: string | null;
  readonly category?: string | null;
  readonly now: Date;
}

export interface UpdateSkillDeps {
  readonly skills: SkillRepository;
}

export class UpdateSkill {
  constructor(private readonly deps: UpdateSkillDeps) {}

  async execute(input: UpdateSkillInput): Promise<void> {
    await this.deps.skills.update(
      input.id,
      {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
      },
      input.now,
    );
  }
}
