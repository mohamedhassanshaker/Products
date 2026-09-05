import type {
  AdminUserRepositoryPort,
  RefreshTokenRepositoryPort,
  TokenDigestPort,
  TokenSignerPort,
} from '../domain/ports';
import { RefreshUseCase } from './refresh.use-case';

const user = {
  id: 'admin-1',
  email: 'a@b.com',
  passwordHash: 'x',
  roles: ['admin'],
  disabled: false,
  tenantIds: [],
};

describe('RefreshUseCase', () => {
  let users: jest.Mocked<AdminUserRepositoryPort>;
  let refresh: jest.Mocked<RefreshTokenRepositoryPort>;
  let signer: jest.Mocked<TokenSignerPort>;
  let digest: jest.Mocked<TokenDigestPort>;
  let useCase: RefreshUseCase;

  beforeEach(() => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      countOperators: jest.fn(),
      create: jest.fn(),
      emailExists: jest.fn(),
      createFirstOperator: jest.fn(),
    };
    refresh = { create: jest.fn(), findByHash: jest.fn(), revokeFamily: jest.fn(), revokeByHash: jest.fn() };
    signer = { signAccess: jest.fn().mockReturnValue('access') };
    digest = {
      digest: jest.fn().mockReturnValue('hash'),
      randomToken: jest.fn().mockReturnValue('new-token'),
      randomFamilyId: jest.fn().mockReturnValue('new-family'),
    };
    useCase = new RefreshUseCase(users, refresh, signer, digest);
  });

  it('rejects an unknown token', async () => {
    refresh.findByHash.mockResolvedValue(null);
    await expect(useCase.execute('token')).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('rejects and revokes the family for a revoked token (reuse)', async () => {
    refresh.findByHash.mockResolvedValue({
      id: '1',
      adminUserId: 'admin-1',
      tokenHash: 'hash',
      familyId: 'family-1',
      expiresAt: new Date(Date.now() + 10000),
      revokedAt: new Date(),
    });
    await expect(useCase.execute('token')).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    expect(refresh.revokeFamily).toHaveBeenCalledWith('family-1');
  });

  it('rejects and revokes the family for an expired token', async () => {
    refresh.findByHash.mockResolvedValue({
      id: '1',
      adminUserId: 'admin-1',
      tokenHash: 'hash',
      familyId: 'family-1',
      expiresAt: new Date(Date.now() - 1000),
      revokedAt: null,
    });
    await expect(useCase.execute('token')).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
    expect(refresh.revokeFamily).toHaveBeenCalledWith('family-1');
  });

  it('rejects and revokes the family when the user no longer exists', async () => {
    refresh.findByHash.mockResolvedValue({
      id: '1',
      adminUserId: 'admin-1',
      tokenHash: 'hash',
      familyId: 'family-1',
      expiresAt: new Date(Date.now() + 10000),
      revokedAt: null,
    });
    users.findById.mockResolvedValue(null);
    await expect(useCase.execute('token')).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('rejects and revokes the family when the user is disabled', async () => {
    refresh.findByHash.mockResolvedValue({
      id: '1',
      adminUserId: 'admin-1',
      tokenHash: 'hash',
      familyId: 'family-1',
      expiresAt: new Date(Date.now() + 10000),
      revokedAt: null,
    });
    users.findById.mockResolvedValue({ ...user, disabled: true });
    await expect(useCase.execute('token')).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });
  });

  it('rotates the token and returns a fresh pair on success', async () => {
    refresh.findByHash.mockResolvedValue({
      id: '1',
      adminUserId: 'admin-1',
      tokenHash: 'hash',
      familyId: 'family-1',
      expiresAt: new Date(Date.now() + 10000),
      revokedAt: null,
    });
    users.findById.mockResolvedValue(user);
    const result = await useCase.execute('token');
    expect(result.access_token).toBe('access');
    expect(refresh.revokeByHash).toHaveBeenCalledWith('hash');
  });
});
