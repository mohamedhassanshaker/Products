import type { AdminUserRepositoryPort, TokenDigestPort } from '../../auth';
import type { InviteRepositoryPort } from '../domain/ports';
import { CreateInviteUseCase } from './create-invite.use-case';
import type { AdminActor } from '../../../common/auth/admin-actor';

const operator: AdminActor = { id: 'admin-1', email: 'op@example.com', roles: ['operator'], tenantIds: [] };
const scopedAdmin: AdminActor = {
  id: 'admin-2',
  email: 'admin@example.com',
  roles: ['admin'],
  tenantIds: ['tenant-1'],
};

describe('CreateInviteUseCase', () => {
  let invites: jest.Mocked<InviteRepositoryPort>;
  let users: jest.Mocked<AdminUserRepositoryPort>;
  let digest: jest.Mocked<TokenDigestPort>;
  let useCase: CreateInviteUseCase;

  beforeEach(() => {
    invites = { create: jest.fn(), findById: jest.fn(), findByTokenHash: jest.fn(), list: jest.fn(), markAccepted: jest.fn(), delete: jest.fn() };
    users = { findByEmail: jest.fn(), findById: jest.fn(), countOperators: jest.fn(), create: jest.fn(), emailExists: jest.fn(), createFirstOperator: jest.fn() };
    digest = { digest: jest.fn().mockReturnValue('hash'), randomToken: jest.fn().mockReturnValue('token'), randomFamilyId: jest.fn() };
    useCase = new CreateInviteUseCase(invites, users, digest);
  });

  it('rejects a non-operator granting the operator role', async () => {
    await expect(
      useCase.execute(scopedAdmin, { email: 'x@y.com', roles: ['operator'], tenant_ids: [] }),
    ).rejects.toMatchObject({ code: 'AUTH_ROLE_FORBIDDEN' });
  });

  it('rejects an admin inviting to a tenant they are not assigned to', async () => {
    await expect(
      useCase.execute(scopedAdmin, { email: 'x@y.com', roles: ['admin'], tenant_ids: ['tenant-99'] }),
    ).rejects.toMatchObject({ code: 'TENANT_FORBIDDEN' });
  });

  it('rejects a duplicate email', async () => {
    users.emailExists.mockResolvedValue(true);
    await expect(
      useCase.execute(operator, { email: 'x@y.com', roles: ['admin'], tenant_ids: [] }),
    ).rejects.toMatchObject({ code: 'AUTH_EMAIL_EXISTS' });
  });

  it('creates an invite and clears tenant_ids for an operator grant', async () => {
    users.emailExists.mockResolvedValue(false);
    invites.create.mockResolvedValue({
      id: 'invite-1',
      email: 'x@y.com',
      roles: ['operator'],
      tokenHash: 'hash',
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
      acceptedAt: null,
      createdBy: operator.id,
      createdAt: new Date(),
      tenantIds: [],
    });
    const result = await useCase.execute(operator, { email: 'x@y.com', roles: ['operator'], tenant_ids: ['tenant-1'] });
    expect(result.invite_token).toBe('token');
    expect(invites.create).toHaveBeenCalledWith(expect.objectContaining({ tenantIds: [] }));
  });

  it('allows a scoped admin to invite within their own tenant', async () => {
    users.emailExists.mockResolvedValue(false);
    invites.create.mockResolvedValue({
      id: 'invite-2',
      email: 'x@y.com',
      roles: ['admin'],
      tokenHash: 'hash',
      expiresAt: new Date(),
      acceptedAt: null,
      createdBy: scopedAdmin.id,
      createdAt: new Date(),
      tenantIds: ['tenant-1'],
    });
    const result = await useCase.execute(scopedAdmin, {
      email: 'x@y.com',
      roles: ['admin'],
      tenant_ids: ['tenant-1'],
    });
    expect(result.tenant_ids).toEqual(['tenant-1']);
  });
});
