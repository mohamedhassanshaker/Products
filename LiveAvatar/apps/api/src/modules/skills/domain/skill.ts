/** A skill's triggering mode (R-S2) — model-decided (LLM selects from descriptions) or router-decided (deterministic). */
export type SkillTriggerMode = 'model' | 'router';

/** A `SkillVersion` row's own lifecycle state — `draft` is mutable in place, `published` is immutable (R-S3). */
export type SkillVersionStatus = 'draft' | 'published';

/** A skill's own knowledge-retrieval scoping (A5.5) — a metadata-filter *condition* reference against the tenant's existing `knowledge.pipeline`, never a second pipeline (see the plan doc's Phase 13 follow-up note). */
export interface SkillKnowledgeFilterRecord {
  sourceRefs: string[];
  topK?: number;
  minScore?: number;
}

/**
 * `SkillVersion` aggregate (`ARCHITECTURE_NOTES.md` §5.1) as the
 * application layer sees it. Immutable once `status: 'published'` — the
 * one place this codebase's "append-only per version" discipline is
 * enforced by convention (repository methods) rather than a DB constraint,
 * mirroring `ConfigVersion`'s own "only publish writes a row" discipline.
 */
export interface SkillVersionRecord {
  id: string;
  skillId: string;
  versionNumber: number;
  description: string;
  instructions: string;
  triggerMode: SkillTriggerMode;
  /** `api_ref` strings — never inlined `ToolDefinition` rows. */
  tools: string[];
  knowledgeFilters: SkillKnowledgeFilterRecord;
  budgetMs: number;
  /** Phase 14 (BL-052 follow-up, R-S6) — an optional `HitlGate` id this skill declares for itself, resolved by id (never inlined). */
  hitlGateId: string | null;
  environments: string[];
  status: SkillVersionStatus;
  publishedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
}

/** `Skill` aggregate — identity + "which version is currently live" only; content lives entirely on `SkillVersionRecord` rows. */
export interface SkillRecord {
  id: string;
  tenantId: string | null;
  platformPublished: boolean;
  name: string;
  slug: string;
  currentPublishedVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** A `Skill` plus its currently-relevant version rows — the shape every CRUD use case actually returns. */
export interface SkillWithVersionsRecord extends SkillRecord {
  draftVersion: SkillVersionRecord | null;
  publishedVersion: SkillVersionRecord | null;
}

/**
 * Derives a stable, URL/id-safe slug from a skill name when the caller
 * doesn't supply one explicitly — mirrors `tools/domain/validation.ts`'s
 * `deriveApiRef` in spirit, hyphenated (not underscored) to match the
 * wireframe's own example slugs (`order-tracking`, `tech-triage`).
 * @param name - Skill name (already validated)
 */
export function deriveSkillSlug(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  const base = slug.length > 0 ? slug : 'skill';
  return base.slice(0, 80);
}
