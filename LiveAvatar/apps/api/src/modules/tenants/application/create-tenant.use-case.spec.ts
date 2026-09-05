import { AppError } from '../../../common/errors/app-error';
import type { TenantRepositoryPort } from '../domain/ports';
import { TENANT_LIMIT } from '../domain/tenant';
import { CreateTenantUseCase } from './create-tenant.use-case';

function makeRecord(overrides: Partial<Parameters<typeof Object.assign>[0]> = {}) {
  return {
    id: 'tenant-1',
    name: 'Acme',
    slug: 'acme',
    status: 'active' as const,
    roomNamespace: 'acme',
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    providerStackSummary: 'Not configured',
    ...overrides,
  };
}

describe('CreateTenantUseCase', () => {
  let repo: jest.Mocked<TenantRepositoryPort>;
  let prisma: { transaction: jest.Mock };
  let useCase: CreateTenantUseCase;

  beforeEach(() => {
    repo = {
      create: jest.fn(),
      findById: jest.fn(),
      findBySlug: jest.fn(),
      count: jest.fn(),
      list: jest.fn(),
      updateName: jest.fn(),
      updateStatus: jest.fn(),
    };
    prisma = {
      transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) =>
        fn({
          tenant: { create: jest.fn().mockResolvedValue({ id: 'tenant-1' }) },
          dataResidencyPolicy: { create: jest.fn().mockResolvedValue({}) },
          alertPolicy: { create: jest.fn().mockResolvedValue({}) },
          deploymentConfig: { create: jest.fn().mockResolvedValue({}) },
        }),
      ),
    };
    useCase = new CreateTenantUseCase(repo, prisma as never);
  });

  it('creates a tenant with room_namespace = slug and returns the DTO', async () => {
    repo.count.mockResolvedValue(0);
    repo.findBySlug.mockResolvedValue(null);
    repo.findById.mockResolvedValue(makeRecord());

    const result = await useCase.execute({ name: 'Acme', slug: 'acme' });

    expect(result).toMatchObject({ id: 'tenant-1', slug: 'acme', room_namespace: 'acme' });
    expect(prisma.transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects an invalid name before touching the repository', async () => {
    await expect(useCase.execute({ name: '', slug: 'acme' })).rejects.toMatchObject({
      code: 'TENANT_NAME_INVALID',
    });
    expect(repo.count).not.toHaveBeenCalled();
  });

  it('rejects an invalid slug', async () => {
    await expect(useCase.execute({ name: 'Acme', slug: 'BAD' })).rejects.toMatchObject({
      code: 'TENANT_SLUG_INVALID',
    });
  });

  it('rejects when the platform tenant limit is reached', async () => {
    repo.count.mockResolvedValue(TENANT_LIMIT);
    await expect(useCase.execute({ name: 'Acme', slug: 'acme' })).rejects.toMatchObject({
      code: 'TENANT_LIMIT_REACHED',
      httpStatus: 400,
    });
    expect(prisma.transaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicate slug with 409', async () => {
    repo.count.mockResolvedValue(1);
    repo.findBySlug.mockResolvedValue(makeRecord());
    await expect(useCase.execute({ name: 'Acme', slug: 'acme' })).rejects.toMatchObject({
      code: 'TENANT_SLUG_EXISTS',
      httpStatus: 409,
    });
  });

  it('throws if the created tenant cannot be re-read (defensive branch)', async () => {
    repo.count.mockResolvedValue(0);
    repo.findBySlug.mockResolvedValue(null);
    repo.findById.mockResolvedValue(null);
    await expect(useCase.execute({ name: 'Acme', slug: 'acme' })).rejects.toBeInstanceOf(AppError);
  });
});
