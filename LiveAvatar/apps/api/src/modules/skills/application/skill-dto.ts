import type { SkillDto, SkillVersionDto } from '@liveavatar/contracts';
import type { SkillVersionRecord, SkillWithVersionsRecord } from '../domain/skill';

function toSkillVersionDto(record: SkillVersionRecord): SkillVersionDto {
  return {
    id: record.id,
    version_number: record.versionNumber,
    status: record.status,
    // `name` lives on the `Skill` row, not the version — populated by the
    // caller (`toSkillDto`) since this mapper only ever sees a version in
    // isolation; kept as an empty placeholder here is wrong, so this
    // function is intentionally not exported — see `toSkillDto` below,
    // which fills it in from the owning `Skill`.
    name: '',
    description: record.description,
    instructions: record.instructions,
    trigger_mode: record.triggerMode,
    tools: record.tools,
    knowledge_filters: {
      source_refs: record.knowledgeFilters.sourceRefs,
      top_k: record.knowledgeFilters.topK,
      min_score: record.knowledgeFilters.minScore,
    },
    budget_ms: record.budgetMs,
    hitl_gate_id: record.hitlGateId,
    environments: record.environments,
    published_at: record.publishedAt ? record.publishedAt.toISOString() : null,
    created_by: record.createdBy,
    created_at: record.createdAt.toISOString(),
  };
}

/** Maps a `Skill` + its draft/published version bodies to the wire DTO, including the pre-computed `used_by_agent_count`. */
export function toSkillDto(record: SkillWithVersionsRecord, usedByAgentCount: number): SkillDto {
  const withName = (version: SkillVersionRecord | null): SkillVersionDto | null =>
    version ? { ...toSkillVersionDto(version), name: record.name } : null;
  return {
    id: record.id,
    tenant_id: record.tenantId ?? '',
    name: record.name,
    slug: record.slug,
    draft_version: withName(record.draftVersion),
    published_version: withName(record.publishedVersion),
    used_by_agent_count: usedByAgentCount,
    created_at: record.createdAt.toISOString(),
    updated_at: record.updatedAt.toISOString(),
  };
}
