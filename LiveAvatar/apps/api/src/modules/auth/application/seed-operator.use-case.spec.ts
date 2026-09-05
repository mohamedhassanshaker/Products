import type { AdminUserRepositoryPort, PasswordHasherPort } from '../domain/ports';
import { SeedOperatorUseCase } from './seed-operator.use-case';

describe('SeedOperatorUseCase', () => {
  let users: jest.Mocked<AdminUserRepositoryPort>;
  let hasher: jest.Mocked<PasswordHasherPort>;
  let useCase: SeedOperatorUseCase;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      countOperators: jest.fn(),
      create: jest.fn(),
      emailExists: jest.fn(),
      createFirstOperator: jest.fn(),
    };
    hasher = { hash: jest.fn().mockResolvedValue('hashed'), verify: jest.fn() };
    useCase = new SeedOperatorUseCase(users, hasher);
  });

  it('rejects when an operator already exists', async () => {
    users.countOperators.mockResolvedValue(1);
    await expect(useCase.execute({ email: 'a@b.com', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'AUTH_ALREADY_SEEDED',
      httpStatus: 409,
    });
  });

  it('rejects an invalid password with a bootstrap-appropriate code, not the invite code', async () => {
    users.countOperators.mockResolvedValue(0);
    await expect(useCase.execute({ email: 'a@b.com', password: 'short' })).rejects.toMatchObject({
      code: 'AUTH_PASSWORD_INVALID',
    });
  });

  it('rejects a duplicate email', async () => {
    users.countOperators.mockResolvedValue(0);
    users.emailExists.mockResolvedValue(true);
    await expect(useCase.execute({ email: 'a@b.com', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'AUTH_EMAIL_EXISTS',
    });
  });

  it('creates the first operator', async () => {
    users.countOperators.mockResolvedValue(0);
    users.emailExists.mockResolvedValue(false);
    users.createFirstOperator.mockResolvedValue({
      id: 'admin-1',
      email: 'a@b.com',
      passwordHash: 'hashed',
      roles: ['operator'],
      disabled: false,
      tenantIds: [],
    });
    const result = await useCase.execute({ email: 'a@b.com', password: 'abcd1234' });
    expect(result).toEqual({ id: 'admin-1', email: 'a@b.com', roles: ['operator'] });
    expect(users.createFirstOperator).toHaveBeenCalledWith({ email: 'a@b.com', passwordHash: 'hashed' });
  });

  it('rejects when createFirstOperator loses the race atomically (concurrent seed calls)', async () => {
    users.countOperators.mockResolvedValue(0);
    users.emailExists.mockResolvedValue(false);
    users.createFirstOperator.mockResolvedValue(null);
    await expect(useCase.execute({ email: 'a@b.com', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'AUTH_ALREADY_SEEDED',
      httpStatus: 409,
    });
  });
});
