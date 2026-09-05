import type { InviteRepositoryPort } from '../domain/ports';
import { RevokeInviteUseCase } from './revoke-invite.use-case';
import type { AdminActor } from '../../../common/auth/admin-actor';

const operator: AdminActor = { id: 'admin-1', email: 'op@example.com', roles: ['operator'], tenantIds: [] };
const creator: AdminActor = { id: 'admin-2', email: 'a@b.com', roles: ['admin'], tenantIds: ['tenant-1'] };
const otherAdmin: AdminActor = { id: 'admin-3', email: 'c@d.com', roles: ['admin'], tenantIds: ['tenant-1'] };

const invite = {
  id: 'invite-1',
  email: 'x@y.com',
  roles: ['admin'],
  tokenHash: 'h',
  expiresAt: new Date(),
  acceptedAt: null,
  createdBy: 'admin-2',
  createdAt: new Date(),
  tenantIds: ['tenant-1'],
};

describe('RevokeInviteUseCase', () => {
  function makeRepo(): jest.Mocked<InviteRepositoryPort> {
    return {
      create: jest.fn(),
      findById: jest.fn(),
      findByTokenHash: jest.fn(),
      list: jest.fn(),
      markAccepted: jest.fn(),
      delete: jest.fn(),
    };
  }

  it('rejects an unknown invite id', async () => {
    const invites = makeRepo();
    invites.findById.mockResolvedValue(null);
    await expect(new RevokeInviteUseCase(invites).execute(operator, 'missing')).rejects.toMatchObject({
      code: 'AUTH_INVITE_INVALID',
      httpStatus: 404,
    });
  });

  it('rejects an already-accepted invite', async () => {
    const invites = makeRepo();
    invites.findById.mockResolvedValue({ ...invite, acceptedAt: new Date() });
    await expect(new RevokeInviteUseCase(invites).execute(operator, 'invite-1')).rejects.toMatchObject({
      code: 'AUTH_INVITE_INVALID',
    });
  });

  it('rejects an admin revoking an invite they did not create', async () => {
    const invites = makeRepo();
    invites.findById.mockResolvedValue(invite);
    await expect(new RevokeInviteUseCase(invites).execute(otherAdmin, 'invite-1')).rejects.toMatchObject({
      code: 'TENANT_FORBIDDEN',
      httpStatus: 403,
    });
  });

  it('allows the creating admin to revoke their own invite', async () => {
    const invites = makeRepo();
    invites.findById.mockResolvedValue(invite);
    await new RevokeInviteUseCase(invites).execute(creator, 'invite-1');
    expect(invites.delete).toHaveBeenCalledWith('invite-1');
  });

  it('allows an operator to revoke any invite', async () => {
    const invites = makeRepo();
    invites.findById.mockResolvedValue(invite);
    await new RevokeInviteUseCase(invites).execute(operator, 'invite-1');
    expect(invites.delete).toHaveBeenCalledWith('invite-1');
  });
});
