import type {
  AdminUserRepositoryPort,
  LoginRateLimiterPort,
  PasswordHasherPort,
  RefreshTokenRepositoryPort,
  TokenDigestPort,
  TokenSignerPort,
} from '../domain/ports';
import { LoginUseCase } from './login.use-case';

const user = {
  id: 'admin-1',
  email: 'a@b.com',
  passwordHash: 'hashed',
  roles: ['admin'],
  disabled: false,
  tenantIds: ['tenant-1'],
};

describe('LoginUseCase', () => {
  let users: jest.Mocked<AdminUserRepositoryPort>;
  let hasher: jest.Mocked<PasswordHasherPort>;
  let signer: jest.Mocked<TokenSignerPort>;
  let refresh: jest.Mocked<RefreshTokenRepositoryPort>;
  let digest: jest.Mocked<TokenDigestPort>;
  let limiter: jest.Mocked<LoginRateLimiterPort>;
  let useCase: LoginUseCase;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      countOperators: jest.fn(),
      create: jest.fn(),
      emailExists: jest.fn(),
      createFirstOperator: jest.fn(),
    };
    hasher = { hash: jest.fn(), verify: jest.fn() };
    signer = { signAccess: jest.fn().mockReturnValue('access') };
    refresh = { create: jest.fn(), findByHash: jest.fn(), revokeFamily: jest.fn(), revokeByHash: jest.fn() };
    digest = {
      digest: jest.fn().mockReturnValue('d'),
      randomToken: jest.fn().mockReturnValue('r'),
      randomFamilyId: jest.fn().mockReturnValue('f'),
    };
    limiter = { tooManyFailures: jest.fn(), recordFailure: jest.fn(), clear: jest.fn() };
    useCase = new LoginUseCase(users, hasher, signer, refresh, digest, limiter);
  });

  it('rejects when rate limited', async () => {
    limiter.tooManyFailures.mockResolvedValue(true);
    await expect(useCase.execute({ email: 'a@b.com', password: 'x' }, '1.2.3.4')).rejects.toMatchObject({
      code: 'AUTH_RATE_LIMITED',
      httpStatus: 429,
    });
  });

  it('rejects an unknown email with AUTH_INVALID_CREDENTIALS and records a failure', async () => {
    limiter.tooManyFailures.mockResolvedValue(false);
    users.findByEmail.mockResolvedValue(null);
    await expect(useCase.execute({ email: 'a@b.com', password: 'x' }, '1.2.3.4')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
    expect(limiter.recordFailure).toHaveBeenCalled();
  });

  it('rejects a wrong password with the same AUTH_INVALID_CREDENTIALS code', async () => {
    limiter.tooManyFailures.mockResolvedValue(false);
    users.findByEmail.mockResolvedValue(user);
    hasher.verify.mockResolvedValue(false);
    await expect(useCase.execute({ email: 'a@b.com', password: 'x' }, '1.2.3.4')).rejects.toMatchObject({
      code: 'AUTH_INVALID_CREDENTIALS',
    });
  });

  it('rejects a disabled user with AUTH_USER_DISABLED', async () => {
    limiter.tooManyFailures.mockResolvedValue(false);
    users.findByEmail.mockResolvedValue({ ...user, disabled: true });
    hasher.verify.mockResolvedValue(true);
    await expect(useCase.execute({ email: 'a@b.com', password: 'x' }, '1.2.3.4')).rejects.toMatchObject({
      code: 'AUTH_USER_DISABLED',
      httpStatus: 403,
    });
  });

  it('issues a token pair and clears the rate limiter on success', async () => {
    limiter.tooManyFailures.mockResolvedValue(false);
    users.findByEmail.mockResolvedValue(user);
    hasher.verify.mockResolvedValue(true);
    const result = await useCase.execute({ email: 'a@b.com', password: 'x' }, '1.2.3.4');
    expect(result.access_token).toBe('access');
    expect(result.user.email).toBe('a@b.com');
    expect(limiter.clear).toHaveBeenCalled();
  });

  it('issue() mints a fresh pair for an already-authenticated identity', async () => {
    const result = await useCase.issue(user);
    expect(result.access_token).toBe('access');
  });
});
