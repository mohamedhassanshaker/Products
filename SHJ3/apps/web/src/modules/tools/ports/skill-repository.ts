/** B3 step 4 sub-tab A / B5 tab 1 — the callable-capability catalogue. */

import type { SkillInvocationKind } from "../domain/tool-catalog.js";

export interface SkillRow {
  readonly id: string;
  readonly key: string;
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly invocationKind: SkillInvocationKind;
  readonly apiConnectorId: string | null;
  readonly mcpToolId: string | null;
  readonly inputSchemaJson: string;
  readonly outputSchemaJson: string | null;
  readonly rateLimitPolicyId: string | null;
  readonly isSystem: boolean;
  readonly isAttachedByDefault: boolean;
}

export interface NewNativeSkillInput {
  readonly name: string;
  readonly description: string | null;
  readonly category: string | null;
  readonly inputSchemaJson: string;
  readonly outputSchemaJson: string | null;
  readonly isAttachedByDefault: boolean;
  readonly now: Date;
}

export type DeleteSkillResult =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly reason: "tools.skill_in_use";
      readonly boundAgentVersionIds: readonly string[];
    };

export interface SkillRepository {
  list(): Promise<readonly SkillRow[]>;
  get(id: string): Promise<SkillRow | null>;

  /** `key` is derived from `name`, disambiguated against existing live keys, inside the adapter (mirrors `PrismaRoleRepository.uniqueRoleKey`'s precedent). Only for `invocationKind = 'Native'` — connector/MCP-tool skills are projected automatically (`TR_ApiConnectors_projectSkill`) or created by `bindMcpToolAsSkill` below. */
  createNative(input: NewNativeSkillInput): Promise<SkillRow>;

  update(
    id: string,
    input: {
      readonly name?: string;
      readonly description?: string | null;
      readonly category?: string | null;
    },
    now: Date,
  ): Promise<void>;

  /** Refused (`tools.skill_in_use`) while any enabled `ToolBinding` references it. */
  softDelete(id: string, now: Date): Promise<DeleteSkillResult>;
}
