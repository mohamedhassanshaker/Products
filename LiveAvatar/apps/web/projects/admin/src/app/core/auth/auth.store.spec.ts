import { TestBed } from '@angular/core/testing';
import { of, throwError, firstValueFrom } from 'rxjs';
import { AuthApiService, type AppClientError } from '@liveavatar/web-shared';
import type { AdminUserDto, TokenPairDto } from '@liveavatar/contracts';
import { AuthStore } from './auth.store';
import { TokenStorageService } from './token-storage.service';

const user: AdminUserDto = { id: 'u-1', email: 'op@example.com', roles: ['operator'], tenant_ids: [] };
const session: TokenPairDto = {
  access_token: 'access-1',
  expires_in: 28800,
  refresh_token: 'refresh-1',
  user,
};

describe('AuthStore', () => {
  let authApi: {
    login: jest.Mock;
    refresh: jest.Mock;
    logout: jest.Mock;
    me: jest.Mock;
    acceptInvite: jest.Mock;
  };
  let tokenStorage: { getRefreshToken: jest.Mock; setRefreshToken: jest.Mock; clear: jest.Mock };
  let store: InstanceType<typeof AuthStore>;

  beforeEach(() => {
    authApi = {
      login: jest.fn(),
      refresh: jest.fn(),
      logout: jest.fn(),
      me: jest.fn(),
      acceptInvite: jest.fn(),
    };
    tokenStorage = { getRefreshToken: jest.fn(), setRefreshToken: jest.fn(), clear: jest.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthApiService, useValue: authApi },
        { provide: TokenStorageService, useValue: tokenStorage },
      ],
    });
    store = TestBed.inject(AuthStore);
  });

  it('starts idle and unauthenticated', () => {
    expect(store.status()).toBe('idle');
    expect(store.isAuthenticated()).toBe(false);
    expect(store.isLoading()).toBe(false);
    expect(store.roles()).toEqual([]);
    expect(store.isOperator()).toBe(false);
    expect(store.isAdmin()).toBe(false);
    expect(store.roleLabel()).toBe('');
  });

  it('isLoading is true synchronously once login is called, before the API responds', () => {
    authApi.login.mockReturnValue(of(session));
    // login() patches status to 'loading' synchronously before returning the
    // observable — assert that here, since of() resolves as soon as it is
    // subscribed to and would otherwise mask this intermediate state.
    const obs = store.login({ email: 'op@example.com', password: 'password1' });
    expect(store.isLoading()).toBe(true);
    obs.subscribe().unsubscribe();
  });

  it('roleLabel joins both roles when a user holds operator and admin', async () => {
    const dualRoleSession: TokenPairDto = {
      ...session,
      user: { ...user, roles: ['operator', 'admin'] },
    };
    authApi.login.mockReturnValue(of(dualRoleSession));
    await firstValueFrom(store.login({ email: 'op@example.com', password: 'password1' }));
    expect(store.roleLabel()).toBe('Operator · Admin');
    expect(store.isAdmin()).toBe(true);
  });

  it('roleLabel is "Admin" for an admin-only user', async () => {
    const adminSession: TokenPairDto = { ...session, user: { ...user, roles: ['admin'] } };
    authApi.login.mockReturnValue(of(adminSession));
    await firstValueFrom(store.login({ email: 'a@b.com', password: 'password1' }));
    expect(store.roleLabel()).toBe('Admin');
    expect(store.roles()).toEqual(['admin']);
    expect(store.isOperator()).toBe(false);
  });

  it('login success persists the refresh token and marks the store authenticated', async () => {
    authApi.login.mockReturnValue(of(session));

    await firstValueFrom(store.login({ email: 'op@example.com', password: 'password1' }));

    expect(store.status()).toBe('authenticated');
    expect(store.isAuthenticated()).toBe(true);
    expect(store.isLoading()).toBe(false);
    expect(store.accessToken()).toBe('access-1');
    expect(store.user()).toEqual(user);
    expect(store.roles()).toEqual(['operator']);
    expect(store.isOperator()).toBe(true);
    expect(store.isAdmin()).toBe(false);
    expect(store.roleLabel()).toBe('Operator');
    expect(tokenStorage.setRefreshToken).toHaveBeenCalledWith('refresh-1');
  });

  it('acceptInvite failure marks the store unauthenticated and records the error', async () => {
    const error: AppClientError = {
      status: 409,
      code: 'AUTH_EMAIL_EXISTS',
      message: 'An admin with this email already exists.',
      details: {},
    };
    authApi.acceptInvite.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(store.acceptInvite({ token: 't', password: 'password1' }))).rejects.toBe(error);

    expect(store.status()).toBe('unauthenticated');
    expect(store.error()).toBe(error);
  });

  it('login failure marks the store unauthenticated and records the error', async () => {
    const error: AppClientError = {
      status: 401,
      code: 'AUTH_INVALID_CREDENTIALS',
      message: 'Email or password is incorrect.',
      details: {},
    };
    authApi.login.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(store.login({ email: 'op@example.com', password: 'wrong' }))).rejects.toBe(error);

    expect(store.status()).toBe('unauthenticated');
    expect(store.error()).toBe(error);
    expect(store.accessToken()).toBeNull();
  });

  it('acceptInvite bootstraps a session the same way as login', async () => {
    authApi.acceptInvite.mockReturnValue(of(session));

    await firstValueFrom(store.acceptInvite({ token: 't', password: 'password1' }));

    expect(store.status()).toBe('authenticated');
    expect(store.user()).toEqual(user);
  });

  it('refresh with no stored refresh token clears session and rejects without calling the API', async () => {
    tokenStorage.getRefreshToken.mockReturnValue(null);

    await expect(firstValueFrom(store.refresh())).rejects.toMatchObject({ code: 'AUTH_REFRESH_INVALID' });

    expect(authApi.refresh).not.toHaveBeenCalled();
    expect(tokenStorage.clear).toHaveBeenCalled();
    expect(store.status()).toBe('unauthenticated');
  });

  it('refresh success rotates the token and keeps the store authenticated', async () => {
    tokenStorage.getRefreshToken.mockReturnValue('refresh-1');
    authApi.refresh.mockReturnValue(
      of({ access_token: 'access-2', expires_in: 28800, refresh_token: 'refresh-2' }),
    );

    await firstValueFrom(store.refresh());

    expect(store.status()).toBe('authenticated');
    expect(store.accessToken()).toBe('access-2');
    expect(tokenStorage.setRefreshToken).toHaveBeenCalledWith('refresh-2');
  });

  it('refresh failure clears the session', async () => {
    tokenStorage.getRefreshToken.mockReturnValue('refresh-1');
    const error: AppClientError = { status: 401, code: 'AUTH_REFRESH_INVALID', message: 'Session expired. Sign in again.', details: {} };
    authApi.refresh.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(store.refresh())).rejects.toBe(error);

    expect(store.status()).toBe('unauthenticated');
    expect(tokenStorage.clear).toHaveBeenCalled();
  });

  it('loadCurrentUser populates the user and marks authenticated', async () => {
    authApi.me.mockReturnValue(of(user));

    await firstValueFrom(store.loadCurrentUser());

    expect(store.user()).toEqual(user);
    expect(store.status()).toBe('authenticated');
  });

  it('loadCurrentUser failure clears the session', async () => {
    const error: AppClientError = { status: 401, code: 'AUTH_UNAUTHORIZED', message: 'Sign in required.', details: {} };
    authApi.me.mockReturnValue(throwError(() => error));

    await expect(firstValueFrom(store.loadCurrentUser())).rejects.toBe(error);
    expect(store.status()).toBe('unauthenticated');
  });

  it('logout with a stored refresh token calls the API and clears state', async () => {
    tokenStorage.getRefreshToken.mockReturnValue('refresh-1');
    authApi.logout.mockReturnValue(of(undefined));

    await firstValueFrom(store.logout());

    expect(authApi.logout).toHaveBeenCalledWith('refresh-1');
    expect(tokenStorage.clear).toHaveBeenCalled();
    expect(store.status()).toBe('unauthenticated');
  });

  it('logout still clears local state when the API call fails (not trapped)', async () => {
    tokenStorage.getRefreshToken.mockReturnValue('refresh-1');
    authApi.logout.mockReturnValue(throwError(() => new Error('network')));

    await firstValueFrom(store.logout());

    expect(tokenStorage.clear).toHaveBeenCalled();
    expect(store.status()).toBe('unauthenticated');
  });

  it('logout with no stored refresh token clears state without calling the API', async () => {
    tokenStorage.getRefreshToken.mockReturnValue(null);

    await firstValueFrom(store.logout());

    expect(authApi.logout).not.toHaveBeenCalled();
    expect(store.status()).toBe('unauthenticated');
  });

  it('markUnauthenticated clears session state directly', () => {
    store.markUnauthenticated();
    expect(store.status()).toBe('unauthenticated');
    expect(tokenStorage.clear).toHaveBeenCalled();
  });
});
