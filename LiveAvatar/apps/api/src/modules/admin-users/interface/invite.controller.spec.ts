import { InviteController } from './invite.controller';
import type { AdminActor } from '../../../common/auth/admin-actor';

describe('InviteController', () => {
  const createInvite = { execute: jest.fn() };
  const listInvites = { execute: jest.fn() };
  const revokeInvite = { execute: jest.fn() };
  const acceptInvite = { execute: jest.fn() };
  const controller = new InviteController(
    createInvite as never,
    listInvites as never,
    revokeInvite as never,
    acceptInvite as never,
  );
  const actor: AdminActor = { id: '1', email: 'a@b.com', roles: ['operator'], tenantIds: [] };

  afterEach(() => jest.clearAllMocks());

  it('create delegates to CreateInviteUseCase', () => {
    createInvite.execute.mockReturnValue({ id: 'invite-1' });
    controller.create(actor, { email: 'x@y.com', roles: ['admin'], tenant_ids: [] });
    expect(createInvite.execute).toHaveBeenCalledWith(actor, { email: 'x@y.com', roles: ['admin'], tenant_ids: [] });
  });

  it('list delegates with numeric page parsing', () => {
    listInvites.execute.mockReturnValue({ items: [], total: 0 });
    controller.list(actor, 'pending', '2');
    expect(listInvites.execute).toHaveBeenCalledWith(actor, { status: 'pending', page: 2 });
  });

  it('list defaults page to 1 when absent', () => {
    listInvites.execute.mockReturnValue({ items: [], total: 0 });
    controller.list(actor, undefined, undefined);
    expect(listInvites.execute).toHaveBeenCalledWith(actor, { status: undefined, page: 1 });
  });

  it('accept delegates to AcceptInviteUseCase', () => {
    acceptInvite.execute.mockReturnValue({ access_token: 't' });
    controller.accept({ token: 't', password: 'abcd1234' });
    expect(acceptInvite.execute).toHaveBeenCalledWith({ token: 't', password: 'abcd1234' });
  });

  it('revoke delegates to RevokeInviteUseCase', async () => {
    revokeInvite.execute.mockResolvedValue(undefined);
    await controller.revoke(actor, 'invite-1');
    expect(revokeInvite.execute).toHaveBeenCalledWith(actor, 'invite-1');
  });
});
