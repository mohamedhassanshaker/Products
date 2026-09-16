/**
 * The callable-capability catalogue with live per-skill bind counts — backs both
 * B3 step 4A's toggle list and B5 tab 1's catalogue-with-counts table.
 *
 * ## Why this join lives here, not on a port
 *
 * `SkillRepository` and `ToolBindingRepository` are two different tables,
 * neither of which knows about the other (mirrors `iam`'s `list-users.ts`/
 * `list-teams-with-live-membership.ts` identical reasoning). `ToolBindingRepository.
 * countEnabledBindingsBySkill()`'s own doc comment calls these counts "live
 * queries, not a cache, which is what makes them reflected immediately" — so this
 * use case calls it on every `execute()`, never caching the merge.
 *
 * ## Why B5 shows counts rather than its own bind control
 *
 * `tasks/todo.md`'s B-3 module-boundary review: B5's tabs 1-3 are catalogue CRUD
 * plus aggregate counts, not an independent bind surface — the actual bind/unbind
 * action is wizard-step-4-only (`bind-tool.ts`/`unbind-tool.ts`), called from
 * both surfaces' Server Actions against the identical `ToolBindingRepository`.
 * `boundAgentVersionCount` is what lets B5 tab 1 show "how many agent versions
 * use this skill" without B5 needing its own bind UI at all.
 */

import type { SkillRepository, SkillRow } from "../ports/skill-repository.js";
import type { ToolBindingRepository } from "../ports/tool-binding-repository.js";

export type SkillCatalogRow = SkillRow & {
  readonly boundAgentVersionCount: number;
};

export interface ListSkillsResult {
  readonly rows: readonly SkillCatalogRow[];
}

export interface ListSkillsDeps {
  readonly skills: SkillRepository;
  readonly bindings: ToolBindingRepository;
}

export class ListSkills {
  constructor(private readonly deps: ListSkillsDeps) {}

  async execute(): Promise<ListSkillsResult> {
    const { skills, bindings } = this.deps;

    const [skillRows, counts] = await Promise.all([
      skills.list(),
      bindings.countEnabledBindingsBySkill(),
    ]);

    const rows = skillRows.map((skill): SkillCatalogRow => ({
      ...skill,
      boundAgentVersionCount: counts.get(skill.id) ?? 0,
    }));

    return { rows };
  }
}
