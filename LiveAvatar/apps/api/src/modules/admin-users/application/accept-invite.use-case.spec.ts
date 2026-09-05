import type { AdminUserRepositoryPort, PasswordHasherPort, RefreshTokenRepositoryPort, TokenDigestPort, TokenSignerPort } from '../../auth';
import type { InviteRepositoryPort } from '../domain/ports';
import { AcceptInviteUseCase } from './accept-invite.use-case';

const invite = {
  id: 'invite-1',
  email: 'x@y.com',
  roles: ['admin'],
  tokenHash: 'hash',
  expiresAt: new Date(Date.now() + 60_000),
  acceptedAt: null as Date | null,
  createdBy: 'admin-1',
  createdAt: new Date(),
  tenantIds: ['tenant-1'],
};

describe('AcceptInviteUseCase', () => {
  function makeDeps() {
    const invites: jest.Mocked<InviteRepositoryPort> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByTokenHash: jest.fn(),
      list: jest.fn(),
      markAccepted: jest.fn(),
      delete: jest.fn(),
    };
    const users: jest.Mocked<AdminUserRepositoryPort> = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      countOperators: jest.fn(),
      create: jest.fn(),
      emailExists: jest.fn(),
      createFirstOperator: jest.fn(),
    };
    const hasher: jest.Mocked<PasswordHasherPort> = { hash: jest.fn().mockResolvedValue('hashed'), verify: jest.fn() };
    const signer: jest.Mocked<TokenSignerPort> = { signAccess: jest.fn().mockReturnValue('access') };
    const refresh: jest.Mocked<RefreshTokenRepositoryPort> = {
      create: jest.fn(),
      findByHash: jest.fn(),
      revokeFamily: jest.fn(),
      revokeByHash: jest.fn(),
    };
    const digest: jest.Mocked<TokenDigestPort> = {
      digest: jest.fn().mockReturnValue('hash'),
      randomToken: jest.fn().mockReturnValue('r'),
      randomFamilyId: jest.fn().mockReturnValue('f'),
    };
    return {
      useCase: new AcceptInviteUseCase(invites, users, hasher, signer, refresh, digest),
      invites,
      users,
    };
  }

  it('rejects an invalid password', async () => {
    const { useCase } = makeDeps();
    await expect(useCase.execute({ token: 't', password: 'short' })).rejects.toThrow();
  });

  it('rejects an unknown token', async () => {
    const { useCase, invites } = makeDeps();
    invites.findByTokenHash.mockResolvedValue(null);
    await expect(useCase.execute({ token: 't', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'AUTH_INVITE_INVALID',
    });
  });

  it('rejects an already-accepted invite', async () => {
    const { useCase, invites } = makeDeps();
    invites.findByTokenHash.mockResolvedValue({ ...invite, acceptedAt: new Date() });
    await expect(useCase.execute({ token: 't', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'AUTH_INVITE_INVALID',
    });
  });

  it('rejects an expired invite', async () => {
    const { useCase, invites } = makeDeps();
    invites.findByTokenHash.mockResolvedValue({ ...invite, expiresAt: new Date(Date.now() - 1000) });
    await expect(useCase.execute({ token: 't', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'AUTH_INVITE_INVALID',
    });
  });

  it('rejects a duplicate email', async () => {
    const { useCase, invites, users } = makeDeps();
    invites.findByTokenHash.mockResolvedValue(invite);
    users.emailExists.mockResolvedValue(true);
    await expect(useCase.execute({ token: 't', password: 'abcd1234' })).rejects.toMatchObject({
      code: 'AUTH_EMAIL_EXISTS',
    });
  });

  it('clears tenant_ids when the invite grants the operator role', async () => {
    const { useCase, invites, users } = makeDeps();
    invites.findByTokenHash.mockResolvedValue({ ...invite, roles: ['operator'], tenantIds: ['tenant-1'] });
    users.emailExists.mockResolvedValue(false);
    users.create.mockResolvedValue({
      id: 'admin-2',
      email: 'x@y.com',
      passwordHash: 'hashed',
      roles: ['operator'],
      disabled: false,
      tenantIds: [],
    });
    await useCase.execute({ token: 't', password: 'abcd1234' });
    expect(users.create).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: [] }));
  });

  it('creates the admin, marks the invite accepted, and returns a session', async () => {
    const { useCase, invites, users } = makeDeps();
    invites.findByTokenHash.mockResolvedValue(invite);
    users.emailExists.mockResolvedValue(false);
    users.create.mockResolvedValue({
      id: 'admin-2',
      email: 'x@y.com',
      passwordHash: 'hashed',
      roles: ['admin'],
      disabled: false,
      tenantIds: ['tenant-1'],
    });
    const result = await useCase.execute({ token: 't', password: 'abcd1234' });
    expect(result.access_token).toBe('access');
    expect(result.user.email).toBe('x@y.com');
    expect(invites.markAccepted).toHaveBeenCalledWith('invite-1');
  });
});
