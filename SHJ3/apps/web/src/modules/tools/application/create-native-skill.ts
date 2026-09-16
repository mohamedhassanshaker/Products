/**
 * Create a native skill — B3 step 4 sub-tab A / B5 tab 1's **+ Add skill**.
 *
 * Thin by design, mirroring `iam`'s `create-team.ts`/`create-custom-role.ts`:
 * `SkillRepository.createNative` owns the actual write, including deriving and
 * disambiguating `key` from `name` (that port method's own doc comment) — logic
 * this use case must not duplicate, or the two could disagree about what key a
 * given name produces. Only for `invocationKind = 'Native'` — connector/MCP-tool
 * skills are projected automatically elsewhere (`TR_ApiConnectors_projectSkill`,
 * or a future MCP-tool bind path), never through this use case.
 */

import type { SkillRepository, SkillRow } from "../ports/skill-repository.js";

export interface CreateNativeSkillInput {
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly inputSchemaJson: string;
  readonly outputSchemaJson: string | null;
  readonly isAttachedByDefault: boolean;
  readonly now: Date;
}

export interface CreateNativeSkillResult {
  readonly skill: SkillRow;
}

export interface CreateNativeSkillDeps {
  readonly skills: SkillRepository;
}

export class CreateNativeSkill {
  constructor(private readonly deps: CreateNativeSkillDeps) {}

  async execute(input: CreateNativeSkillInput): Promise<CreateNativeSkillResult> {
    const skill = await this.deps.skills.createNative(input);
    return { skill };
  }
}
