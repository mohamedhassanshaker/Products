import type { AdminIdentity } from '../domain/admin-identity';
import type { RefreshTokenRepositoryPort, TokenDigestPort, TokenSignerPort } from '../domain/ports';
import { issueTokenPair, toUserDto } from './token-pair';

const operator: AdminIdentity = {
  id: 'admin-1',
  email: 'op@example.com',
  passwordHash: 'x',
  roles: ['operator'],
  disabled: false,
  tenantIds: ['tenant-1'],
};

const admin: AdminIdentity = {
  id: 'admin-2',
  email: 'admin@example.com',
  passwordHash: 'x',
  roles: ['admin'],
  disabled: false,
  tenantIds: ['tenant-1'],
};

describe('toUserDto', () => {
  it('empties tenant_ids for an operator regardless of stored memberships', () => {
    expect(toUserDto(operator).tenant_ids).toEqual([]);
  });

  it('keeps tenant_ids for a scoped admin', () => {
    expect(toUserDto(admin).tenant_ids).toEqual(['tenant-1']);
  });
});

describe('issueTokenPair', () => {
  it('signs an access token, creates a refresh row, and returns the pair', async () => {
    const signer: TokenSignerPort = { signAccess: jest.fn().mockReturnValue('access-token') };
    const refresh: RefreshTokenRepositoryPort = {
      create: jest.fn().mockResolvedValue(undefined),
      findByHash: jest.fn(),
      revokeFamily: jest.fn(),
      revokeByHash: jest.fn(),
    };
    const digest: TokenDigestPort = {
      digest: jest.fn().mockReturnValue('digested'),
      randomToken: jest.fn().mockReturnValue('opaque-token'),
      randomFamilyId: jest.fn().mockReturnValue('family-1'),
    };

    const pair = await issueTokenPair(admin, signer, refresh, digest);

    expect(pair).toEqual({
      access_token: 'access-token',
      expires_in: 28800,
      refresh_token: 'opaque-token',
    });
    expect(refresh.create).toHaveBeenCalledWith(
      expect.objectContaining({ adminUserId: 'admin-2', tokenHash: 'digested', familyId: 'family-1' }),
    );
  });

  it('empties tenantIds in the signed access claims for an operator', async () => {
    const signer: TokenSignerPort = { signAccess: jest.fn().mockReturnValue('t') };
    const refresh: RefreshTokenRepositoryPort = {
      create: jest.fn().mockResolvedValue(undefined),
      findByHash: jest.fn(),
      revokeFamily: jest.fn(),
      revokeByHash: jest.fn(),
    };
    const digest: TokenDigestPort = {
      digest: jest.fn().mockReturnValue('d'),
      randomToken: jest.fn().mockReturnValue('r'),
      randomFamilyId: jest.fn().mockReturnValue('f'),
    };
    await issueTokenPair(operator, signer, refresh, digest);
    expect(signer.signAccess).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: [] }));
  });

  it('reuses a provided familyId instead of generating a new one', async () => {
    const signer: TokenSignerPort = { signAccess: jest.fn().mockReturnValue('t') };
    const refresh: RefreshTokenRepositoryPort = {
      create: jest.fn().mockResolvedValue(undefined),
      findByHash: jest.fn(),
      revokeFamily: jest.fn(),
      revokeByHash: jest.fn(),
    };
    const digest: TokenDigestPort = {
      digest: jest.fn().mockReturnValue('d'),
      randomToken: jest.fn().mockReturnValue('r'),
      randomFamilyId: jest.fn().mockReturnValue('should-not-be-used'),
    };
    await issueTokenPair(admin, signer, refresh, digest, 'existing-family');
    expect(refresh.create).toHaveBeenCalledWith(expect.objectContaining({ familyId: 'existing-family' }));
    expect(digest.randomFamilyId).not.toHaveBeenCalled();
  });
});
