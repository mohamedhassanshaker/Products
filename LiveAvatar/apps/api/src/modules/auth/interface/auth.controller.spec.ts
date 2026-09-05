import { AppError } from '../../../common/errors/app-error';
import { AuthController } from './auth.controller';
import type { AdminActor } from '../../../common/auth/admin-actor';

function makeReq(ip: string) {
  return { ip, socket: { remoteAddress: ip } } as never;
}

describe('AuthController', () => {
  const login = { execute: jest.fn() };
  const refresh = { execute: jest.fn() };
  const logout = { execute: jest.fn() };
  const seed = { execute: jest.fn() };
  const me = { execute: jest.fn() };
  const controller = new AuthController(login as never, refresh as never, logout as never, seed as never, me as never);
  const actor: AdminActor = { id: '1', email: 'a@b.com', roles: ['admin'], tenantIds: [] };

  afterEach(() => jest.clearAllMocks());

  it('loginUser strips the IPv6-mapped prefix and delegates to LoginUseCase', async () => {
    login.execute.mockResolvedValue({ access_token: 't' });
    await controller.loginUser({ email: 'a@b.com', password: 'x' }, makeReq('::ffff:1.2.3.4'));
    expect(login.execute).toHaveBeenCalledWith({ email: 'a@b.com', password: 'x' }, '1.2.3.4');
  });

  it('loginUser falls back to the socket address when req.ip is absent', async () => {
    login.execute.mockResolvedValue({});
    await controller.loginUser({ email: 'a@b.com', password: 'x' }, { socket: { remoteAddress: '5.6.7.8' } } as never);
    expect(login.execute).toHaveBeenCalledWith(expect.anything(), '5.6.7.8');
  });

  it('loginUser falls back to 0.0.0.0 when neither ip nor socket address is available', async () => {
    login.execute.mockResolvedValue({});
    await controller.loginUser({ email: 'a@b.com', password: 'x' }, { socket: {} } as never);
    expect(login.execute).toHaveBeenCalledWith(expect.anything(), '0.0.0.0');
  });

  it('refreshSession delegates to RefreshUseCase', async () => {
    refresh.execute.mockResolvedValue({ access_token: 't' });
    await controller.refreshSession({ refresh_token: 'r' });
    expect(refresh.execute).toHaveBeenCalledWith('r');
  });

  it('logoutUser delegates to LogoutUseCase', async () => {
    logout.execute.mockResolvedValue(undefined);
    await controller.logoutUser({ refresh_token: 'r' });
    expect(logout.execute).toHaveBeenCalledWith('r');
  });

  it('getMe delegates to GetMeUseCase with the current actor', () => {
    me.execute.mockReturnValue({ id: '1' });
    controller.getMe(actor);
    expect(me.execute).toHaveBeenCalledWith(actor);
  });

  it('seedOperator rejects a missing/incorrect bootstrap secret', () => {
    process.env.BOOTSTRAP_SECRET = 'correct';
    expect(() => controller.seedOperator('wrong', { email: 'a@b.com', password: 'abcd1234' })).toThrow(
      AppError,
    );
    expect(() => controller.seedOperator(undefined, { email: 'a@b.com', password: 'abcd1234' })).toThrow(
      AppError,
    );
  });

  it('seedOperator delegates when the bootstrap secret matches', () => {
    process.env.BOOTSTRAP_SECRET = 'correct';
    seed.execute.mockReturnValue({ id: '1' });
    controller.seedOperator('correct', { email: 'a@b.com', password: 'abcd1234' });
    expect(seed.execute).toHaveBeenCalled();
  });
});
