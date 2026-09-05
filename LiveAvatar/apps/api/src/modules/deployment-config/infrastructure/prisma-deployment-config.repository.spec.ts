import { PrismaDeploymentConfigRepository } from './prisma-deployment-config.repository';

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'config-1',
    tenantId: 'tenant-1',
    yamlText: 'version: 1\ndeployment:\n  name: Acme\n',
    status: 'draft',
    transportProvider: null,
    sttProvider: null,
    llmProvider: null,
    llmFallbackProvider: null,
    ttsProvider: null,
    avatarProvider: null,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedBy: null,
    publishedAt: null,
    pendingRollbackFromVersionId: null,
    ...overrides,
  };
}

describe('PrismaDeploymentConfigRepository', () => {
  /**
   * `deploymentConfig`/`configVersion` are shared objects between `db` and the
   * `$transaction` callback's `tx` — mirrors how `PrismaService.transaction`
   * works in this codebase (`common/prisma/prisma.service.spec.ts`'s
   * `base.$transaction = jest.fn(async (fn) => fn(fakeTx))` precedent) and
   * lets existing assertions against `db.deploymentConfig.updateMany` keep
   * working unchanged even though the real code calls it through `tx`.
   */
  function makePrisma() {
    const deploymentConfig = { findFirst: jest.fn(), updateMany: jest.fn() };
    const configVersion = { findFirst: jest.fn().mockResolvedValue(null), updateMany: jest.fn(), create: jest.fn() };
    const tx: { deploymentConfig: typeof deploymentConfig; configVersion: typeof configVersion } = {
      deploymentConfig,
      configVersion,
    };
    const db = {
      deploymentConfig,
      configVersion,
      $transaction: jest.fn(async (fn: (tx: { deploymentConfig: typeof deploymentConfig; configVersion: typeof configVersion }) => unknown) => fn(tx)),
    };
    return { db };
  }

  const providers = { transport: null, stt: null, llm: null, llmFallback: null, tts: null, avatar: null };

  it('findByTenantId returns null when absent', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst.mockResolvedValue(null);
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    expect(await repo.findByTenantId('tenant-1')).toBeNull();
  });

  it('findByTenantId parses the stored YAML into the structured field', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst.mockResolvedValue(makeRow());
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    const result = await repo.findByTenantId('tenant-1');
    expect(result?.structured).toMatchObject({ version: 1, deployment: { name: 'Acme' } });
  });

  it('findByTenantId tolerates an empty yamlText (new tenant)', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst.mockResolvedValue(makeRow({ yamlText: '' }));
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    const result = await repo.findByTenantId('tenant-1');
    expect(result?.structured).toEqual({});
  });

  it('findByTenantId falls back to an empty structured object on unparseable stored YAML (defensive)', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst.mockResolvedValue(makeRow({ yamlText: '{ not: [valid' }));
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    const result = await repo.findByTenantId('tenant-1');
    expect(result?.structured).toEqual({});
  });

  it('findByTenantId surfaces pendingRollbackFromVersionId', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst.mockResolvedValue(makeRow({ pendingRollbackFromVersionId: 'version-7' }));
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    const result = await repo.findByTenantId('tenant-1');
    expect(result?.pendingRollbackFromVersionId).toBe('version-7');
  });

  it('save returns missing when no row exists for the tenant', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst.mockResolvedValue(null);
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    const result = await repo.save(
      'tenant-1',
      { yamlText: 'version: 1', status: 'draft', providers, updatedBy: null },
      new Date(),
    );
    expect(result).toBe('missing');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('save returns conflict on a stale If-Match', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst.mockResolvedValueOnce(makeRow());
    db.deploymentConfig.updateMany.mockResolvedValue({ count: 0 });
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    const result = await repo.save(
      'tenant-1',
      { yamlText: 'version: 1', status: 'draft', providers, updatedBy: null },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(result).toBe('conflict');
  });

  it('save persists denormalized providers and stamps publishedAt only when provided', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst
      .mockResolvedValueOnce(makeRow())
      .mockResolvedValueOnce(makeRow({ status: 'published', llmProvider: 'openai' }));
    db.deploymentConfig.updateMany.mockResolvedValue({ count: 1 });
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    const publishedAt = new Date();
    const result = await repo.save(
      'tenant-1',
      {
        yamlText: 'version: 1',
        status: 'published',
        providers: { transport: 'livekit', stt: 'deepgram', llm: 'openai', llmFallback: null, tts: 'fish-speech', avatar: 'bithuman' },
        updatedBy: 'admin-1',
        publishedAt,
      },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    expect(db.deploymentConfig.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ publishedAt }) }),
    );
    expect(result).toMatchObject({ status: 'published' });
  });

  it('save omits publishedAt from the write entirely when undefined (draft save keeps prior value)', async () => {
    const { db } = makePrisma();
    db.deploymentConfig.findFirst.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce(makeRow());
    db.deploymentConfig.updateMany.mockResolvedValue({ count: 1 });
    const repo = new PrismaDeploymentConfigRepository({ db } as never);
    await repo.save(
      'tenant-1',
      { yamlText: 'version: 1', status: 'draft', providers, updatedBy: null },
      new Date('2026-01-01T00:00:00.000Z'),
    );
    const dataArg = (db.deploymentConfig.updateMany.mock.calls[0][0] as { data: Record<string, unknown> }).data;
    expect(dataArg).not.toHaveProperty('publishedAt');
  });

  describe('ConfigVersion insert-on-publish (Phase 9, BL-035)', () => {
    it('publish inserts a ConfigVersion row with versionNumber = max+1, in the same $transaction', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce(makeRow({ status: 'published' }));
      db.deploymentConfig.updateMany.mockResolvedValue({ count: 1 });
      db.configVersion.findFirst.mockResolvedValue({ versionNumber: 4 });
      const repo = new PrismaDeploymentConfigRepository({ db } as never);
      const publishedAt = new Date();

      await repo.save(
        'tenant-1',
        {
          yamlText: 'version: 1',
          status: 'published',
          providers,
          updatedBy: 'admin-1',
          publishedAt,
          createVersion: { publishedAt, createdBy: 'admin-1' },
        },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(db.$transaction).toHaveBeenCalledTimes(1);
      expect(db.configVersion.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tenantId: 'tenant-1',
          versionNumber: 5,
          status: 'published',
          publishedAt,
          createdBy: 'admin-1',
          rolledBackFrom: null,
        }),
      });
      // Any prior published version is superseded so at most one row stays `published`.
      expect(db.configVersion.updateMany).toHaveBeenCalledWith({
        where: { tenantId: 'tenant-1', status: 'published' },
        data: { status: 'superseded' },
      });
    });

    it('publish starts versionNumber at 1 when no prior ConfigVersion exists', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce(makeRow({ status: 'published' }));
      db.deploymentConfig.updateMany.mockResolvedValue({ count: 1 });
      db.configVersion.findFirst.mockResolvedValue(null);
      const repo = new PrismaDeploymentConfigRepository({ db } as never);
      const publishedAt = new Date();

      await repo.save(
        'tenant-1',
        { yamlText: 'version: 1', status: 'published', providers, updatedBy: 'admin-1', publishedAt, createVersion: { publishedAt, createdBy: 'admin-1' } },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(db.configVersion.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ versionNumber: 1 }) }));
    });

    it('a draft save does NOT insert a ConfigVersion row', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce(makeRow());
      db.deploymentConfig.updateMany.mockResolvedValue({ count: 1 });
      const repo = new PrismaDeploymentConfigRepository({ db } as never);

      await repo.save(
        'tenant-1',
        { yamlText: 'version: 1', status: 'draft', providers, updatedBy: 'admin-1' },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(db.configVersion.create).not.toHaveBeenCalled();
      expect(db.configVersion.findFirst).not.toHaveBeenCalled();
    });

    it('publish reads and clears pendingRollbackFromVersionId into the new version\'s rolledBackFrom, regardless of the input field', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst
        .mockResolvedValueOnce(makeRow({ pendingRollbackFromVersionId: 'version-row-7' }))
        .mockResolvedValueOnce(makeRow({ status: 'published' }));
      db.deploymentConfig.updateMany.mockResolvedValue({ count: 1 });
      db.configVersion.findFirst.mockResolvedValue(null);
      const repo = new PrismaDeploymentConfigRepository({ db } as never);
      const publishedAt = new Date();

      await repo.save(
        'tenant-1',
        {
          yamlText: 'version: 1',
          status: 'published',
          providers,
          updatedBy: 'admin-1',
          publishedAt,
          createVersion: { publishedAt, createdBy: 'admin-1' },
        },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(db.configVersion.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ rolledBackFrom: 'version-row-7' }) }),
      );
      // The column is always cleared on a publish, whatever the caller passed.
      expect(db.deploymentConfig.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pendingRollbackFromVersionId: null }) }),
      );
    });

    it('a rollback-created draft save sets pendingRollbackFromVersionId without touching ConfigVersion', async () => {
      const { db } = makePrisma();
      db.deploymentConfig.findFirst.mockResolvedValueOnce(makeRow()).mockResolvedValueOnce(makeRow());
      db.deploymentConfig.updateMany.mockResolvedValue({ count: 1 });
      const repo = new PrismaDeploymentConfigRepository({ db } as never);

      await repo.save(
        'tenant-1',
        { yamlText: 'version: 1', status: 'draft', providers, updatedBy: 'admin-1', pendingRollbackFromVersionId: 'version-row-3' },
        new Date('2026-01-01T00:00:00.000Z'),
      );

      expect(db.deploymentConfig.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ pendingRollbackFromVersionId: 'version-row-3' }) }),
      );
      expect(db.configVersion.create).not.toHaveBeenCalled();
    });
  });
});
