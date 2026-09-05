import type {
  SkillKnowledgeFilterRecord,
  SkillRecord,
  SkillTriggerMode,
  SkillWithVersionsRecord,
} from './skill';

/** Fields accepted on create — always produces a `Skill` row plus its v1 `SkillVersion` draft in one call. */
export interface CreateSkillInput {
  tenantId: string;
  name: string;
  slug: string;
  description: string;
  instructions: string;
  triggerMode: SkillTriggerMode;
  tools: string[];
  knowledgeFilters: SkillKnowledgeFilterRecord;
  budgetMs: number;
  hitlGateId: string | null;
  environments: string[];
  createdBy: string | null;
}

/** Partial fields accepted on a draft edit. `name` patches the `Skill` row; everything else patches the current draft `SkillVersion`. */
export interface UpdateSkillDraftInput {
  name?: string;
  description?: string;
  instructions?: string;
  triggerMode?: SkillTriggerMode;
  tools?: string[];
  knowledgeFilters?: SkillKnowledgeFilterRecord;
  budgetMs?: number;
  hitlGateId?: string | null;
  environments?: string[];
}

/** A tenant's published skill, resolved just enough for V-11 (description cost)/V-12 (existence) and the runtime's bare summary listing. */
export interface PublishedSkillSummaryRecord {
  id: string;
  name: string;
  versionNumber: number;
  description: string;
  /** Phase 14 (BL-052 follow-up, V-7) — the published version's own attached gate, if any. */
  hitlGateId: string | null;
}

/** One `{id, version}` ref resolved to its concrete published version — `version: 'latest'` resolves to `Skill.currentPublishedVersionId`'s own version number. */
export interface ResolvedSkillVersionRecord {
  skillId: string;
  versionNumber: number;
  name: string;
  description: string;
}

/** The full body an internal (agent-facing) lazy fetch needs — always resolved against a *published* version only (R-S3 — a live session never sees a draft body). */
export interface SkillBodyRecord {
  skillId: string;
  tenantId: string;
  versionNumber: number;
  name: string;
  description: string;
  instructions: string;
  triggerMode: SkillTriggerMode;
  tools: string[];
  knowledgeFilters: SkillKnowledgeFilterRecord;
  budgetMs: number;
}

/**
 * `Skill`/`SkillVersion` persistence (`ARCHITECTURE_NOTES.md` §5.1/§5.2),
 * mirroring `ToolDefinitionRepositoryPort`'s shape for the CRUD half, with
 * additions for the version lifecycle (draft-fork-on-first-edit, publish)
 * and the two read paths V-11/V-12 and `GetRuntimeConfigUseCase` need.
 */
export interface SkillRepositoryPort {
  /** Every skill for a tenant, with its draft/published version bodies attached (Skills library table). */
  listByTenant(tenantId: string): Promise<SkillWithVersionsRecord[]>;

  /** Single skill, tenant-scoped, with its draft/published version bodies attached. */
  findById(tenantId: string, id: string): Promise<SkillWithVersionsRecord | null>;

  /** Existence check for the `@@unique([tenantId, slug])` constraint (SKILL_SLUG_EXISTS). */
  findBySlug(tenantId: string, slug: string): Promise<SkillRecord | null>;

  /** Creates the `Skill` row plus its v1 `SkillVersion` (`status: draft`) in one transaction. */
  create(input: CreateSkillInput): Promise<SkillWithVersionsRecord>;

  /**
   * Patches the current draft. If no draft exists (the skill was just
   * published and has no subsequent edit yet), auto-forks a new draft
   * version (`versionNumber = max+1`) copied from the current published
   * content first, then applies `patch` on top — mirrors
   * `rollback-config-version.use-case.ts`'s "creates a new draft" semantics,
   * kept inside the repository so every caller gets the same fork-on-first-
   * edit behavior for free.
   */
  updateDraft(
    tenantId: string,
    skillId: string,
    patch: UpdateSkillDraftInput,
    createdBy: string | null,
  ): Promise<SkillWithVersionsRecord | 'missing'>;

  /** Marks the current draft `published` (`publishedAt` set) and points `Skill.currentPublishedVersionId` at it — never mutates a version already `published` (R-S3). */
  publishDraft(tenantId: string, skillId: string): Promise<SkillWithVersionsRecord | 'missing' | 'no-draft'>;

  delete(tenantId: string, id: string): Promise<boolean>;

  /**
   * How many agents currently reference each of `skillIds` in their live
   * (draft or published) `DeploymentConfig` — the "used by N agents"
   * pre-publish warning (A5.3 UC-S2). One tenant-scoped read regardless of
   * how many ids are asked for (avoids an N+1 query per row in the Skills
   * library table). Every value is bounded to 0/1 today by this codebase's
   * own one-`DeploymentConfig`-row-per-tenant data model — see
   * `infrastructure/prisma-skill.repository.ts`'s own doc comment. Ids with
   * no reference are simply absent from the returned map (never an
   * explicit `0` entry) — callers default a missing key to `0`.
   */
  agentUsageCounts(tenantId: string, skillIds: string[]): Promise<Map<string, number>>;

  /** Every *published* skill for a tenant — V-11 (description cost)/V-12 (existence) read this once per validate/save call. */
  listPublishedByTenant(tenantId: string): Promise<PublishedSkillSummaryRecord[]>;

  /**
   * Resolves one `{id, version}` ref to its concrete published version —
   * `version: 'latest'` resolves against `Skill.currentPublishedVersionId`.
   * `null` when the skill doesn't exist for this tenant, isn't published at
   * all, or the requested explicit version isn't the/a published one
   * (mirrors `GetRuntimeConfigUseCase`'s existing "silently omit, don't
   * fail the whole fetch" precedent for a dangling `agent.tools[]`
   * reference). Tenant-scoped defensively, same as every other
   * tenant-facing read in this codebase — a live session's config only
   * ever names its own tenant's skills (V-12 guarantees this at publish
   * time), but this is cheap, consistent defense-in-depth.
   */
  findPublishedVersion(tenantId: string, skillId: string, version: number | 'latest'): Promise<ResolvedSkillVersionRecord | null>;

  /** Full body for `GET /internal/skills/{id}/versions/{version}/body` — always a concrete, already-resolved version number (never `'latest'` — the caller resolved that via `findPublishedVersion` first). */
  findPublishedVersionBody(skillId: string, versionNumber: number): Promise<SkillBodyRecord | null>;
}

export const SKILL_REPOSITORY = Symbol('SKILL_REPOSITORY');
