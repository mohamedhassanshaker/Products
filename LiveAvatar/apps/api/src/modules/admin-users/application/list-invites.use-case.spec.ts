import type { InviteRepositoryPort } from '../domain/ports';
import { ListInvitesUseCase } from './list-invites.use-case';
import type { AdminActor } from '../../../common/auth/admin-actor';

const actor: AdminActor = { id: 'admin-1', email: 'op@example.com', roles: ['operator'], tenantIds: [] };

describe('ListInvitesUseCase', () => {
  it('maps rows to the DTO shape and forwards pendingOnly for status=pending', async () => {
    const invites: jest.Mocked<InviteRepositoryPort> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByTokenHash: jest.fn(),
      list: jest.fn().mockResolvedValue({
        items: [
          {
            id: 'invite-1',
            email: 'x@y.com',
            roles: ['admin'],
            tokenHash: 'h',
            expiresAt: new Date('2026-02-01T00:00:00.000Z'),
            acceptedAt: null,
            createdBy: 'admin-1',
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            tenantIds: ['tenant-1'],
          },
        ],
        total: 1,
      }),
      markAccepted: jest.fn(),
      delete: jest.fn(),
    };
    const useCase = new ListInvitesUseCase(invites);
    const result = await useCase.execute(actor, { status: 'pending' });
    expect(invites.list).toHaveBeenCalledWith(expect.objectContaining({ pendingOnly: true, page: 1 }));
    expect(result.items[0].accepted_at).toBeNull();
    expect(result.total).toBe(1);
  });

  it('forwards a valid positive page unchanged', async () => {
    const invites: jest.Mocked<InviteRepositoryPort> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByTokenHash: jest.fn(),
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      markAccepted: jest.fn(),
      delete: jest.fn(),
    };
    await new ListInvitesUseCase(invites).execute(actor, { page: 3 });
    expect(invites.list).toHaveBeenCalledWith(expect.objectContaining({ page: 3 }));
  });

  it('defaults page to 1 for a negative page value', async () => {
    const invites: jest.Mocked<InviteRepositoryPort> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByTokenHash: jest.fn(),
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      markAccepted: jest.fn(),
      delete: jest.fn(),
    };
    await new ListInvitesUseCase(invites).execute(actor, { page: -5 });
    expect(invites.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }));
  });

  it('defaults page to 1 for a non-positive page value', async () => {
    const invites: jest.Mocked<InviteRepositoryPort> = {
      create: jest.fn(),
      findById: jest.fn(),
      findByTokenHash: jest.fn(),
      list: jest.fn().mockResolvedValue({ items: [], total: 0 }),
      markAccepted: jest.fn(),
      delete: jest.fn(),
    };
    await new ListInvitesUseCase(invites).execute(actor, { page: 0 });
    expect(invites.list).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pendingOnly: false }));
  });
});
