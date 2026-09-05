import type { AdminUserRepositoryPort } from '../domain/ports';
import { GetMeUseCase } from './get-me.use-case';
import type { AdminActor } from '../../../common/auth/admin-actor';

const actor: AdminActor = { id: 'admin-1', email: 'a@b.com', roles: ['admin'], tenantIds: ['tenant-1'] };
const user = {
  id: 'admin-1',
  email: 'a@b.com',
  passwordHash: 'x',
  roles: ['admin'],
  disabled: false,
  tenantIds: ['tenant-1'],
};

describe('GetMeUseCase', () => {
  it('returns the fresh user DTO', async () => {
    const users: jest.Mocked<AdminUserRepositoryPort> = {
      findByEmail: jest.fn(),
      findById: jest.fn().mockResolvedValue(user),
      countOperators: jest.fn(),
      create: jest.fn(),
      emailExists: jest.fn(),
      createFirstOperator: jest.fn(),
    };
    const result = await new GetMeUseCase(users).execute(actor);
    expect(result.email).toBe('a@b.com');
  });

  it('rejects when the user no longer exists', async () => {
    const users: jest.Mocked<AdminUserRepositoryPort> = {
      findByEmail: jest.fn(),
      findById: jest.fn().mockResolvedValue(null),
      countOperators: jest.fn(),
      create: jest.fn(),
      emailExists: jest.fn(),
      createFirstOperator: jest.fn(),
    };
    await expect(new GetMeUseCase(users).execute(actor)).rejects.toMatchObject({
      code: 'AUTH_UNAUTHORIZED',
    });
  });

  it('rejects when the user has since been disabled', async () => {
    const users: jest.Mocked<AdminUserRepositoryPort> = {
      findByEmail: jest.fn(),
      findById: jest.fn().mockResolvedValue({ ...user, disabled: true }),
      countOperators: jest.fn(),
      create: jest.fn(),
      emailExists: jest.fn(),
      createFirstOperator: jest.fn(),
    };
    await expect(new GetMeUseCase(users).execute(actor)).rejects.toMatchObject({
      code: 'AUTH_UNAUTHORIZED',
    });
  });
});
