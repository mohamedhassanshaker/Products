import type { RefreshTokenRepositoryPort, TokenDigestPort } from '../domain/ports';
import { LogoutUseCase } from './logout.use-case';

describe('LogoutUseCase', () => {
  it('revokes the family for a known token', async () => {
    const refresh: jest.Mocked<RefreshTokenRepositoryPort> = {
      create: jest.fn(),
      findByHash: jest
        .fn()
        .mockResolvedValue({ id: '1', adminUserId: 'a', tokenHash: 'h', familyId: 'fam', expiresAt: new Date(), revokedAt: null }),
      revokeFamily: jest.fn(),
      revokeByHash: jest.fn(),
    };
    const digest: jest.Mocked<TokenDigestPort> = {
      digest: jest.fn().mockReturnValue('h'),
      randomToken: jest.fn(),
      randomFamilyId: jest.fn(),
    };
    await new LogoutUseCase(refresh, digest).execute('token');
    expect(refresh.revokeFamily).toHaveBeenCalledWith('fam');
  });

  it('is a no-op for an unknown token (idempotent logout)', async () => {
    const refresh: jest.Mocked<RefreshTokenRepositoryPort> = {
      create: jest.fn(),
      findByHash: jest.fn().mockResolvedValue(null),
      revokeFamily: jest.fn(),
      revokeByHash: jest.fn(),
    };
    const digest: jest.Mocked<TokenDigestPort> = {
      digest: jest.fn().mockReturnValue('h'),
      randomToken: jest.fn(),
      randomFamilyId: jest.fn(),
    };
    await new LogoutUseCase(refresh, digest).execute('token');
    expect(refresh.revokeFamily).not.toHaveBeenCalled();
  });
});
