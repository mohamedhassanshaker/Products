import type { AppErrorCode } from '@liveavatar/contracts';

/** One publish-blocking issue — mirrors `ConfigError`'s shape closely enough for `PublishSkillUseCase` to map 1:1 onto `AppError`. */
export interface SkillValidationIssue {
  code: Extract<
    AppErrorCode,
    'SKILL_DESCRIPTION_REQUIRED' | 'SKILL_INSTRUCTIONS_REQUIRED' | 'SKILL_TOOL_REF_UNKNOWN' | 'CONFIG_HITL_GATE_UNKNOWN'
  >;
  field?: string;
}

/**
 * Skills' own two-gate validator (`ARCHITECTURE_NOTES.md` §5.4 — "a
 * different aggregate's lifecycle than `deployment-config`'s"), run before
 * a draft `SkillVersion` may be published:
 *
 * 1. Own instructions/description non-empty (Gate A-equivalent, structural).
 * 2. Every attached tool `api_ref` resolves to a known tenant
 *    `ToolDefinition` (Gate B-equivalent, needs a DB read the caller
 *    already performs once — mirrors `toolRefsKnownRule`'s shape).
 * 3. The attached `hitlGateId`, if any, resolves to a known tenant
 *    `HitlGate` (Phase 14 follow-up — replaces the Phase 13 stub). A gate
 *    can only ever be *saved* fully R-H1-specified (`hitl-validation.ts`'s
 *    `validateHitlGateDraft` enforces that at the gate's own save time), so
 *    "the id resolves at all" is the whole check needed here — mirrors
 *    `SKILL_TOOL_REF_UNKNOWN`'s existence-only shape exactly.
 * @param draft - The draft `SkillVersion`'s content fields
 * @param knownToolApiRefs - Every `api_ref` that exists for this tenant
 * @param knownHitlGateIds - Every `HitlGate.id` that exists for this tenant
 */
export function validateSkillDraftForPublish(
  draft: { description: string; instructions: string; tools: string[]; hitlGateId: string | null },
  knownToolApiRefs: Set<string>,
  knownHitlGateIds: Set<string>,
): SkillValidationIssue[] {
  const issues: SkillValidationIssue[] = [];
  if (!draft.description.trim()) {
    issues.push({ code: 'SKILL_DESCRIPTION_REQUIRED' });
  }
  if (!draft.instructions.trim()) {
    issues.push({ code: 'SKILL_INSTRUCTIONS_REQUIRED' });
  }
  for (const ref of draft.tools) {
    if (!knownToolApiRefs.has(ref)) {
      issues.push({ code: 'SKILL_TOOL_REF_UNKNOWN', field: ref });
    }
  }
  if (draft.hitlGateId && !knownHitlGateIds.has(draft.hitlGateId)) {
    issues.push({ code: 'CONFIG_HITL_GATE_UNKNOWN', field: draft.hitlGateId });
  }
  return issues;
}
