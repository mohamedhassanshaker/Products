import { Injectable } from '@nestjs/common';
import { parse as parseYaml } from 'yaml';
import type { PrismaJsonInput } from '../../../common/prisma/json';
import { PrismaService } from '../../../common/prisma/prisma.service';
import type {
  SkillKnowledgeFilterRecord,
  SkillRecord,
  SkillTriggerMode,
  SkillVersionRecord,
  SkillVersionStatus,
  SkillWithVersionsRecord,
} from '../domain/skill';
import type {
  CreateSkillInput,
  PublishedSkillSummaryRecord,
  ResolvedSkillVersionRecord,
  SkillBodyRecord,
  SkillRepositoryPort,
  UpdateSkillDraftInput,
} from '../domain/ports';

/** Prisma row shape for `Skill`. */
type SkillRow = {
  id: string;
  tenantId: string | null;
  platformPublished: boolean;
  name: string;
  slug: string;
  currentPublishedVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Prisma row shape for `SkillVersion`. */
type SkillVersionRow = {
  id: string;
  skillId: string;
  versionNumber: number;
  description: string;
  instructions: string;
  triggerMode: string;
  tools: unknown;
  knowledgeFilters: unknown;
  budgetMs: number;
  hitlGateId: string | null;
  environments: string[];
  status: string;
  publishedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
};

function toKnowledgeFilters(raw: unknown): SkillKnowledgeFilterRecord {
  const obj = (raw ?? {}) as { sourceRefs?: unknown; topK?: unknown; minScore?: unknown };
  return {
    sourceRefs: Array.isArray(obj.sourceRefs) ? (obj.sourceRefs as string[]) : [],
    topK: typeof obj.topK === 'number' ? obj.topK : undefined,
    minScore: typeof obj.minScore === 'number' ? obj.minScore : undefined,
  };
}

function knowledgeFiltersJson(filters: SkillKnowledgeFilterRecord): PrismaJsonInput {
  return {
    sourceRefs: filters.sourceRefs,
    ...(filters.topK !== undefined ? { topK: filters.topK } : {}),
    ...(filters.minScore !== undefined ? { minScore: filters.minScore } : {}),
  } as PrismaJsonInput;
}

function toVersionRecord(row: SkillVersionRow): SkillVersionRecord {
  return {
    id: row.id,
    skillId: row.skillId,
    versionNumber: row.versionNumber,
    description: row.description,
    instructions: row.instructions,
    triggerMode: row.triggerMode as SkillTriggerMode,
    tools: Array.isArray(row.tools) ? (row.tools as string[]) : [],
    knowledgeFilters: toKnowledgeFilters(row.knowledgeFilters),
    budgetMs: row.budgetMs,
    hitlGateId: row.hitlGateId,
    environments: row.environments,
    status: row.status as SkillVersionStatus,
    publishedAt: row.publishedAt,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
  };
}

function toSkillRecord(row: SkillRow): SkillRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    platformPublished: row.platformPublished,
    name: row.name,
    slug: row.slug,
    currentPublishedVersionId: row.currentPublishedVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Minimal shape this repository's `agentUsageCounts` scan needs from a parsed draft config — deliberately loose, mirrors `deployment-config`'s own `DraftAgentConfig`-style local interfaces rather than importing that module's types (would create a module cycle — see this class's own doc comment). */
interface ParsedConfigForUsageScan {
  skills?: { id?: string }[];
  reasoning?: { graph?: { type?: string; skill_id?: string }[] };
}

/**
 * `Skill`/`SkillVersion` persistence (`ARCHITECTURE_NOTES.md` §5.1/§5.2),
 * mirroring `PrismaToolDefinitionRepository`'s shape for the CRUD half.
 *
 * **`agentUsageCounts` deliberately reads `DeploymentConfig` directly via
 * the shared `PrismaService`, never through `deployment-config`'s own
 * repository/module.** `deployment-config` already depends one-directionally
 * on `skills` (V-11/V-12 need `SKILL_REPOSITORY`); the reverse dependency
 * this method would otherwise need (`skills` importing
 * `DeploymentConfigModule`) would close a real NestJS module cycle
 * (`forwardRef` would work but this codebase's own precedent — see the
 * plan doc's Phase 12b "Decisions made this phase" #9 — is to relocate/
 * avoid the cycle rather than reach for `forwardRef`). Reading the shared
 * `deployment_config` table via `PrismaService` (already app-wide, not
 * scoped to any one feature module) sidesteps the cycle entirely: this is
 * a raw-table read of a shared substrate, not a cross-module service call.
 *
 * A tenant has **exactly one** `DeploymentConfig` row
 * (`@@unique([tenantId])`), so "used by N agents" is structurally bounded
 * to 0/1 today — the mechanism (parsing the row's `yaml_text` for a
 * `skills[]`/`skill`-type-node reference) is real and will report a
 * genuine per-agent count the moment a future phase introduces multiple
 * agent configs per tenant; see the plan doc's Phase 13 "Decisions made
 * this phase" note.
 */
@Injectable()
export class PrismaSkillRepository implements SkillRepositoryPort {
  constructor(private readonly prisma: PrismaService) {}

  async listByTenant(tenantId: string): Promise<SkillWithVersionsRecord[]> {
    const rows = await this.prisma.db.skill.findMany({
      where: { tenantId },
      include: { versions: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => this.toWithVersions(row, row.versions));
  }

  async findById(tenantId: string, id: string): Promise<SkillWithVersionsRecord | null> {
    const row = await this.prisma.db.skill.findFirst({ where: { id, tenantId }, include: { versions: true } });
    return row ? this.toWithVersions(row, row.versions) : null;
  }

  async findBySlug(tenantId: string, slug: string): Promise<SkillRecord | null> {
    const row = await this.prisma.db.skill.findFirst({ where: { tenantId, slug } });
    return row ? toSkillRecord(row) : null;
  }

  async create(input: CreateSkillInput): Promise<SkillWithVersionsRecord> {
    const created = await this.prisma.db.$transaction(async (tx) => {
      const skill = await tx.skill.create({
        data: { tenantId: input.tenantId, name: input.name, slug: input.slug },
      });
      const version = await tx.skillVersion.create({
        data: {
          skillId: skill.id,
          versionNumber: 1,
          description: input.description,
          instructions: input.instructions,
          triggerMode: input.triggerMode,
          tools: input.tools as PrismaJsonInput,
          knowledgeFilters: knowledgeFiltersJson(input.knowledgeFilters),
          budgetMs: input.budgetMs,
          hitlGateId: input.hitlGateId,
          environments: input.environments,
          status: 'draft',
          createdBy: input.createdBy,
        },
      });
      return { skill, version };
    });
    return {
      ...toSkillRecord(created.skill),
      draftVersion: toVersionRecord(created.version),
      publishedVersion: null,
    };
  }

  async updateDraft(
    tenantId: string,
    skillId: string,
    patch: UpdateSkillDraftInput,
    createdBy: string | null,
  ): Promise<SkillWithVersionsRecord | 'missing'> {
    const skill = await this.prisma.db.skill.findFirst({ where: { id: skillId, tenantId }, include: { versions: true } });
    if (!skill) {
      return 'missing';
    }

    await this.prisma.db.$transaction(async (tx) => {
      if (patch.name !== undefined) {
        await tx.skill.update({ where: { id: skillId }, data: { name: patch.name } });
      }

      let draft = skill.versions.find((v) => v.status === 'draft');
      if (!draft) {
        // No draft exists (freshly published, no edit since) — fork a new
        // one from the current published content, mirroring
        // `rollback-config-version.use-case.ts`'s "creates a new draft"
        // semantics (`SkillRepositoryPort.updateDraft`'s own doc comment).
        const published = skill.versions.find((v) => v.id === skill.currentPublishedVersionId);
        const maxVersion = skill.versions.reduce((max, v) => Math.max(max, v.versionNumber), 0);
        draft = await tx.skillVersion.create({
          data: {
            skillId,
            versionNumber: maxVersion + 1,
            description: published?.description ?? '',
            instructions: published?.instructions ?? '',
            triggerMode: (published?.triggerMode as SkillTriggerMode) ?? 'model',
            tools: (published?.tools ?? []) as PrismaJsonInput,
            knowledgeFilters: (published?.knowledgeFilters ?? {}) as PrismaJsonInput,
            budgetMs: published?.budgetMs ?? 1500,
            hitlGateId: published?.hitlGateId ?? null,
            environments: published?.environments ?? ['dev', 'staging', 'production'],
            status: 'draft',
            createdBy,
          },
        });
      }

      await tx.skillVersion.update({
        where: { id: draft.id },
        data: {
          ...(patch.description !== undefined ? { description: patch.description } : {}),
          ...(patch.instructions !== undefined ? { instructions: patch.instructions } : {}),
          ...(patch.triggerMode !== undefined ? { triggerMode: patch.triggerMode } : {}),
          ...(patch.tools !== undefined ? { tools: patch.tools as PrismaJsonInput } : {}),
          ...(patch.knowledgeFilters !== undefined ? { knowledgeFilters: knowledgeFiltersJson(patch.knowledgeFilters) } : {}),
          ...(patch.budgetMs !== undefined ? { budgetMs: patch.budgetMs } : {}),
          ...(patch.hitlGateId !== undefined ? { hitlGateId: patch.hitlGateId } : {}),
          ...(patch.environments !== undefined ? { environments: patch.environments } : {}),
        },
      });
    });

    return (await this.findById(tenantId, skillId)) ?? 'missing';
  }

  async publishDraft(tenantId: string, skillId: string): Promise<SkillWithVersionsRecord | 'missing' | 'no-draft'> {
    const skill = await this.prisma.db.skill.findFirst({ where: { id: skillId, tenantId }, include: { versions: true } });
    if (!skill) {
      return 'missing';
    }
    const draft = skill.versions.find((v) => v.status === 'draft');
    if (!draft) {
      return 'no-draft';
    }

    const now = new Date();
    await this.prisma.db.$transaction(async (tx) => {
      await tx.skillVersion.update({ where: { id: draft.id }, data: { status: 'published', publishedAt: now } });
      await tx.skill.update({ where: { id: skillId }, data: { currentPublishedVersionId: draft.id } });
    });

    return (await this.findById(tenantId, skillId)) ?? 'missing';
  }

  async delete(tenantId: string, id: string): Promise<boolean> {
    const result = await this.prisma.db.skill.deleteMany({ where: { id, tenantId } });
    return result.count > 0;
  }

  async agentUsageCounts(tenantId: string, skillIds: string[]): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (skillIds.length === 0) {
      return counts;
    }
    const config = await this.prisma.db.deploymentConfig.findFirst({ where: { tenantId } });
    if (!config?.yamlText) {
      return counts;
    }
    let parsed: ParsedConfigForUsageScan;
    try {
      parsed = (parseYaml(config.yamlText) as ParsedConfigForUsageScan) ?? {};
    } catch {
      return counts;
    }
    const referenced = new Set<string>();
    for (const ref of parsed.skills ?? []) {
      if (ref.id) {
        referenced.add(ref.id);
      }
    }
    for (const node of parsed.reasoning?.graph ?? []) {
      if (node.type === 'skill' && node.skill_id) {
        referenced.add(node.skill_id);
      }
    }
    for (const skillId of skillIds) {
      if (referenced.has(skillId)) {
        counts.set(skillId, 1);
      }
    }
    return counts;
  }

  async listPublishedByTenant(tenantId: string): Promise<PublishedSkillSummaryRecord[]> {
    const rows = await this.prisma.db.skill.findMany({
      where: { tenantId, currentPublishedVersionId: { not: null } },
      include: { versions: true },
    });
    const results: PublishedSkillSummaryRecord[] = [];
    for (const row of rows) {
      const published = row.versions.find((v) => v.id === row.currentPublishedVersionId);
      if (published) {
        results.push({
          id: row.id,
          name: row.name,
          versionNumber: published.versionNumber,
          description: published.description,
          hitlGateId: published.hitlGateId,
        });
      }
    }
    return results;
  }

  async findPublishedVersion(
    tenantId: string,
    skillId: string,
    version: number | 'latest',
  ): Promise<ResolvedSkillVersionRecord | null> {
    const skill = await this.prisma.db.skill.findFirst({ where: { id: skillId, tenantId } });
    if (!skill) {
      return null;
    }
    const versionRow =
      version === 'latest'
        ? skill.currentPublishedVersionId
          ? await this.prisma.db.skillVersion.findFirst({ where: { id: skill.currentPublishedVersionId, status: 'published' } })
          : null
        : await this.prisma.db.skillVersion.findFirst({ where: { skillId, versionNumber: version, status: 'published' } });
    if (!versionRow) {
      return null;
    }
    return { skillId, versionNumber: versionRow.versionNumber, name: skill.name, description: versionRow.description };
  }

  async findPublishedVersionBody(skillId: string, versionNumber: number): Promise<SkillBodyRecord | null> {
    const skill = await this.prisma.db.skill.findUnique({ where: { id: skillId } });
    if (!skill || !skill.tenantId) {
      return null;
    }
    const versionRow = await this.prisma.db.skillVersion.findFirst({
      where: { skillId, versionNumber, status: 'published' },
    });
    if (!versionRow) {
      return null;
    }
    const version = toVersionRecord(versionRow);
    return {
      skillId,
      tenantId: skill.tenantId,
      versionNumber: version.versionNumber,
      name: skill.name,
      description: version.description,
      instructions: version.instructions,
      triggerMode: version.triggerMode,
      tools: version.tools,
      knowledgeFilters: version.knowledgeFilters,
      budgetMs: version.budgetMs,
    };
  }

  private toWithVersions(row: SkillRow, versions: SkillVersionRow[]): SkillWithVersionsRecord {
    const draft = versions.find((v) => v.status === 'draft');
    const published = versions.find((v) => v.id === row.currentPublishedVersionId);
    return {
      ...toSkillRecord(row),
      draftVersion: draft ? toVersionRecord(draft) : null,
      publishedVersion: published ? toVersionRecord(published) : null,
    };
  }
}
