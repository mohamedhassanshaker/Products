import { PrismaSkillRepository } from './prisma-skill.repository';

function makeSkillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'skill-1',
    tenantId: 'tenant-1',
    platformPublished: false,
    name: 'Refunds',
    slug: 'refunds',
    currentPublishedVersionId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function makeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    skillId: 'skill-1',
    versionNumber: 1,
    description: 'Handle refunds',
    instructions: 'Do the refund thing',
    triggerMode: 'model',
    tools: ['issue_refund'],
    knowledgeFilters: { sourceRefs: ['source-1'] },
    budgetMs: 1500,
    hitlGateId: null,
    environments: ['dev', 'staging', 'production'],
    status: 'draft',
    publishedAt: null,
    createdBy: 'admin-1',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('PrismaSkillRepository', () => {
  /** Mirrors `PrismaDeploymentConfigRepository.spec.ts`'s `$transaction` mocking precedent — the same objects back both `db.*` and the `tx` the transaction callback receives. */
  function makePrisma() {
    const skill = { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), deleteMany: jest.fn() };
    const skillVersion = { findFirst: jest.fn(), create: jest.fn(), update: jest.fn() };
    const deploymentConfig = { findFirst: jest.fn() };
    type Tx = { skill: typeof skill; skillVersion: typeof skillVersion };
    const tx: Tx = { skill, skillVersion };
    const db = {
      skill,
      skillVersion,
      deploymentConfig,
      $transaction: jest.fn(async (fn: (tx: Tx) => unknown) => fn(tx)),
    };
    return { db };
  }

  describe('listByTenant / findById', () => {
    it('splits versions into draft/published by status and currentPublishedVersionId', async () => {
      const { db } = makePrisma();
      const publishedRow = makeVersionRow({ id: 'v1', versionNumber: 1, status: 'published' });
      const draftRow = makeVersionRow({ id: 'v2', versionNumber: 2, status: 'draft' });
      db.skill.findFirst.mockResolvedValue({ ...makeSkillRow({ currentPublishedVersionId: 'v1' }), versions: [publishedRow, draftRow] });
      const repo = new PrismaSkillRepository({ db } as never);

      const result = await repo.findById('tenant-1', 'skill-1');

      expect(result?.publishedVersion?.id).toBe('v1');
      expect(result?.draftVersion?.id).toBe('v2');
    });

    it('returns null draft/published when neither exists', async () => {
      const { db } = makePrisma();
      db.skill.findFirst.mockResolvedValue({ ...makeSkillRow(), versions: [] });
      const repo = new PrismaSkillRepository({ db } as never);
      const result = await repo.findById('tenant-1', 'skill-1');
      expect(result?.draftVersion).toBeNull();
      expect(result?.publishedVersion).toBeNull();
    });

    it('scopes findById by tenantId (no cross-tenant read)', async () => {
      const { db } = makePrisma();
      db.skill.findFirst.mockResolvedValue(null);
      const repo = new PrismaSkillRepository({ db } as never);
      await repo.findById('other-tenant', 'skill-1');
      expect(db.skill.findFirst).toHaveBeenCalledWith({ where: { id: 'skill-1', tenantId: 'other-tenant' }, include: { versions: true } });
    });
  });

  describe('create', () => {
    it('creates the Skill row plus its v1 draft SkillVersion in one transaction', async () => {
      const { db } = makePrisma();
      db.skill.create.mockResolvedValue(makeSkillRow());
      db.skillVersion.create.mockResolvedValue(makeVersionRow());
      const repo = new PrismaSkillRepository({ db } as never);

      const result = await repo.create({
        tenantId: 'tenant-1',
        name: 'Refunds',
        slug: 'refunds',
        description: 'Handle refunds',
        instructions: 'Do the refund thing',
        triggerMode: 'model',
        tools: ['issue_refund'],
        knowledgeFilters: { sourceRefs: ['source-1'] },
        budgetMs: 1500,
        hitlGateId: null,
        environments: ['dev', 'staging', 'production'],
        createdBy: 'admin-1',
      });

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.skillVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ versionNumber: 1, status: 'draft' }) }),
      );
      expect(result.draftVersion?.versionNumber).toBe(1);
      expect(result.publishedVersion).toBeNull();
    });
  });

  describe('updateDraft', () => {
    it('returns missing when the skill does not exist for this tenant', async () => {
      const { db } = makePrisma();
      db.skill.findFirst.mockResolvedValue(null);
      const repo = new PrismaSkillRepository({ db } as never);
      expect(await repo.updateDraft('tenant-1', 'skill-1', { description: 'x' }, 'admin-1')).toBe('missing');
    });

    it('patches the existing draft in place without forking a new version', async () => {
      const { db } = makePrisma();
      const draft = makeVersionRow({ id: 'v1', status: 'draft' });
      db.skill.findFirst
        .mockResolvedValueOnce({ ...makeSkillRow(), versions: [draft] })
        .mockResolvedValueOnce({ ...makeSkillRow(), versions: [{ ...draft, description: 'Updated' }] });
      const repo = new PrismaSkillRepository({ db } as never);

      await repo.updateDraft('tenant-1', 'skill-1', { description: 'Updated' }, 'admin-1');

      expect(db.skillVersion.create).not.toHaveBeenCalled();
      expect(db.skillVersion.update).toHaveBeenCalledWith({ where: { id: 'v1' }, data: { description: 'Updated' } });
    });

    it('forks a new draft from the published content when no draft exists', async () => {
      const { db } = makePrisma();
      const published = makeVersionRow({ id: 'v1', versionNumber: 1, status: 'published', description: 'Published desc' });
      db.skill.findFirst
        .mockResolvedValueOnce({ ...makeSkillRow({ currentPublishedVersionId: 'v1' }), versions: [published] })
        .mockResolvedValueOnce({ ...makeSkillRow({ currentPublishedVersionId: 'v1' }), versions: [published, makeVersionRow({ id: 'v2', versionNumber: 2, status: 'draft' })] });
      db.skillVersion.create.mockResolvedValue(makeVersionRow({ id: 'v2', versionNumber: 2, status: 'draft' }));
      const repo = new PrismaSkillRepository({ db } as never);

      const result = await repo.updateDraft('tenant-1', 'skill-1', { budgetMs: 2000 }, 'admin-1');

      expect(db.skillVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ versionNumber: 2, status: 'draft', description: 'Published desc' }) }),
      );
      expect((result as { draftVersion: { versionNumber: number } }).draftVersion.versionNumber).toBe(2);
    });

    it('renames the Skill row when name is patched', async () => {
      const { db } = makePrisma();
      const draft = makeVersionRow({ id: 'v1', status: 'draft' });
      db.skill.findFirst
        .mockResolvedValueOnce({ ...makeSkillRow(), versions: [draft] })
        .mockResolvedValueOnce({ ...makeSkillRow({ name: 'Renamed' }), versions: [draft] });
      const repo = new PrismaSkillRepository({ db } as never);

      await repo.updateDraft('tenant-1', 'skill-1', { name: 'Renamed' }, 'admin-1');

      expect(db.skill.update).toHaveBeenCalledWith({ where: { id: 'skill-1' }, data: { name: 'Renamed' } });
    });
  });

  describe('publishDraft', () => {
    it('returns no-draft when there is nothing pending', async () => {
      const { db } = makePrisma();
      db.skill.findFirst.mockResolvedValue({ ...makeSkillRow(), versions: [makeVersionRow({ status: 'published' })] });
      const repo = new PrismaSkillRepository({ db } as never);
      expect(await repo.publishDraft('tenant-1', 'skill-1')).toBe('no-draft');
      expect(db.skillVersion.update).not.toHaveBeenCalled();
    });

    it('marks the draft published and points currentPublishedVersionId at it', async () => {
      const { db } = makePrisma();
      const draft = makeVersionRow({ id: 'v2', status: 'draft' });
      db.skill.findFirst
        .mockResolvedValueOnce({ ...makeSkillRow(), versions: [draft] })
        .mockResolvedValueOnce({ ...makeSkillRow({ currentPublishedVersionId: 'v2' }), versions: [{ ...draft, status: 'published' }] });
      const repo = new PrismaSkillRepository({ db } as never);

      await repo.publishDraft('tenant-1', 'skill-1');

      expect(db.skillVersion.update).toHaveBeenCalledWith({ where: { id: 'v2' }, data: { status: 'published', publishedAt: expect.any(Date) } });
      expect(db.skill.update).toHaveBeenCalledWith({ where: { id: 'skill-1' }, data: { currentPublishedVersionId: 'v2' } });
    });
  });

  describe('agentUsageCounts', () => {
    it('returns an empty map when the tenant has no DeploymentConfig row', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst.mockResolvedValue(null);
      const repo = new PrismaSkillRepository({ db } as never);
      expect(await repo.agentUsageCounts('tenant-1', ['skill-1'])).toEqual(new Map());
    });

    it('counts a skill referenced via the top-level skills[] attach list', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst.mockResolvedValue({ yamlText: 'skills:\n  - id: skill-1\n    version: latest\n' });
      const repo = new PrismaSkillRepository({ db } as never);
      const counts = await repo.agentUsageCounts('tenant-1', ['skill-1', 'skill-2']);
      expect(counts.get('skill-1')).toBe(1);
      expect(counts.has('skill-2')).toBe(false);
    });

    it('counts a skill referenced via a skill-type graph node', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst.mockResolvedValue({
        yamlText: 'skills: []\nreasoning:\n  graph:\n    - id: skill-1-node\n      type: skill\n      skill_id: skill-1\n',
      });
      const repo = new PrismaSkillRepository({ db } as never);
      const counts = await repo.agentUsageCounts('tenant-1', ['skill-1']);
      expect(counts.get('skill-1')).toBe(1);
    });

    it('never throws on a malformed yamlText, returning an empty map instead', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst.mockResolvedValue({ yamlText: ':::not valid yaml:::[' });
      const repo = new PrismaSkillRepository({ db } as never);
      await expect(repo.agentUsageCounts('tenant-1', ['skill-1'])).resolves.toEqual(new Map());
    });
  });

  describe('findPublishedVersion', () => {
    it('resolves "latest" against currentPublishedVersionId', async () => {
      const { db } = makePrisma();
      db.skill.findFirst.mockResolvedValue(makeSkillRow({ currentPublishedVersionId: 'v3', name: 'Refunds' }));
      db.skillVersion.findFirst.mockResolvedValue(makeVersionRow({ id: 'v3', versionNumber: 3, status: 'published', description: 'v3 desc' }));
      const repo = new PrismaSkillRepository({ db } as never);

      const result = await repo.findPublishedVersion('tenant-1', 'skill-1', 'latest');

      expect(db.skillVersion.findFirst).toHaveBeenCalledWith({ where: { id: 'v3', status: 'published' } });
      expect(result).toEqual({ skillId: 'skill-1', versionNumber: 3, name: 'Refunds', description: 'v3 desc' });
    });

    it('returns null for "latest" when the skill has never been published', async () => {
      const { db } = makePrisma();
      db.skill.findFirst.mockResolvedValue(makeSkillRow({ currentPublishedVersionId: null }));
      const repo = new PrismaSkillRepository({ db } as never);
      expect(await repo.findPublishedVersion('tenant-1', 'skill-1', 'latest')).toBeNull();
    });

    it('resolves an explicit version number only if it is published', async () => {
      const { db } = makePrisma();
      db.skill.findFirst.mockResolvedValue(makeSkillRow());
      db.skillVersion.findFirst.mockResolvedValue(null);
      const repo = new PrismaSkillRepository({ db } as never);

      const result = await repo.findPublishedVersion('tenant-1', 'skill-1', 2);

      expect(db.skillVersion.findFirst).toHaveBeenCalledWith({ where: { skillId: 'skill-1', versionNumber: 2, status: 'published' } });
      expect(result).toBeNull();
    });

    it('returns null for a skill that does not belong to this tenant', async () => {
      const { db } = makePrisma();
      db.skill.findFirst.mockResolvedValue(null);
      const repo = new PrismaSkillRepository({ db } as never);
      expect(await repo.findPublishedVersion('other-tenant', 'skill-1', 'latest')).toBeNull();
    });
  });

  describe('findPublishedVersionBody', () => {
    it('returns null when the skill has no tenantId (platform-library placeholder row)', async () => {
      const { db } = makePrisma();
      db.skill.findUnique.mockResolvedValue(makeSkillRow({ tenantId: null }));
      const repo = new PrismaSkillRepository({ db } as never);
      expect(await repo.findPublishedVersionBody('skill-1', 1)).toBeNull();
    });

    it('returns the resolved tenantId alongside the body (for the caller\'s tool-definition enrichment)', async () => {
      const { db } = makePrisma();
      db.skill.findUnique.mockResolvedValue(makeSkillRow({ tenantId: 'tenant-1' }));
      db.skillVersion.findFirst.mockResolvedValue(makeVersionRow({ versionNumber: 1, status: 'published' }));
      const repo = new PrismaSkillRepository({ db } as never);

      const result = await repo.findPublishedVersionBody('skill-1', 1);

      expect(result?.tenantId).toBe('tenant-1');
      expect(result?.tools).toEqual(['issue_refund']);
    });
  });
});
