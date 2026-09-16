/**
 * Delete (soft) a skill — B3 step 4 sub-tab A / B5 tab 1's Delete action.
 *
 * Pure passthrough to `SkillRepository.softDelete`, whose own doc comment
 * documents the one refusal this use case never has to reimplement: while any
 * enabled `ToolBinding` references the skill, the delete is refused with
 * `tools.skill_in_use` and the list of agent versions still depending on it —
 * returned here exactly as the port shaped it, not translated or narrowed.
 */

import type { DeleteSkillResult, SkillRepository } from "../ports/skill-repository.js";

export interface DeleteSkillInput {
  readonly id: string;
  readonly now: Date;
}

export interface DeleteSkillDeps {
  readonly skills: SkillRepository;
}

export class DeleteSkill {
  constructor(private readonly deps: DeleteSkillDeps) {}

  async execute(input: DeleteSkillInput): Promise<DeleteSkillResult> {
    return this.deps.skills.softDelete(input.id, input.now);
  }
}
