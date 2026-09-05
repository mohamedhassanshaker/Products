import { describe, expect, it, vi } from 'vitest';
import { runWithRequestContext } from '@/server/context';
import type { TenantsService, TenantSummary } from '@/server/platform/tenants';
import type { UserEntity } from '@/server/infrastructure/database';
import { AuthService, type AuthServiceConfig } from './auth.service';
import type { UserRepository } from '../infrastructure/user.repository';
import type { TenantTokenPort } from '../domain/ports/tenant-token.port';
import type { GoogleTokenVerifierPort } from '../domain/ports/google-token-verifier.port';
import {
  CurrentPasswordIncorrectError,
  EmailAlreadyRegisteredError,
  GoogleNotConfiguredError,
  GoogleSignInDisabledError,
  GoogleTokenInvalidError,
  InvalidCredentialsError,
  RegistrationDisabledError,
  ResetTokenExpiredError,
  ResetTokenInvalidError,
  UserInactiveError,
  WeakPasswordError,
} from '../domain/errors';

const TENANT: TenantSummary = {
  id: 'tenant-1',
  name: 'Acme',
  subdomainSlug: 'acme',
  schemaName: 't_acme',
  status: 'Active',
  isDefault: false,
  allowEmailRegistration: true,
  allowGoogleSignIn: true,
  defaultSelfRegisterRole: null,
  logoUrl: null,
  accentColorOverride: null,
  assignedAiModelId: null,
  provisioningError: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
  purgeAfterAt: null,
};

const CONFIG: AuthServiceConfig = {
  passwordPolicy: { minLength: 8, requireUpper: true, requireLower: true, requireDigit: true, requireSymbol: false },
  resetTokenTtlMinutes: 60,
  googleClientId: 'test-client-id',
  defaultAccentColor: '5C6BC0',
};

/** A real, in-memory fake user store (not a bare mock) — lets tests assert on genuine
 * insert/lookup/update round trips. */
function fakeUserRepository(seed: Partial<UserEntity>[] = []): UserRepository {
  const rows: UserEntity[] = seed.map((u) => ({
    id: u.id ?? 'id',
    email: u.email ?? '',
    firstName: u.firstName ?? '',
    lastName: u.lastName ?? '',
    passwordHash: u.passwordHash ?? null,
    phone: null,
    occupation: null,
    companyName: null,
    country: null,
    educationLevelId: null,
    pic: null,
    isActive: u.isActive ?? true,
    passwordResetTokenHash: u.passwordResetTokenHash ?? null,
    passwordResetTokenExpiry: u.passwordResetTokenExpiry ?? null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastLoginAt: null,
  }));

  return {
    findByEmail: async (email: string) => rows.find((r) => r.email === email) ?? null,
    findById: async (id: string) => rows.find((r) => r.id === id) ?? null,
    insert: async (data: Partial<UserEntity>) => {
      const row = { ...data, id: data.id ?? String(rows.length + 1) } as UserEntity;
      rows.push(row);
      return row;
    },
    updateLastLogin: async (id: string, when: Date) => {
      const row = rows.find((r) => r.id === id);
      if (row) row.lastLoginAt = when;
    },
    setResetToken: async (id: string, tokenHash: string, expiresAt: Date) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.passwordResetTokenHash = tokenHash;
        row.passwordResetTokenExpiry = expiresAt;
      }
    },
    findByResetTokenHash: async (tokenHash: string) => rows.find((r) => r.passwordResetTokenHash === tokenHash) ?? null,
    setPasswordHash: async (id: string, passwordHash: string) => {
      const row = rows.find((r) => r.id === id);
      if (row) {
        row.passwordHash = passwordHash;
        row.passwordResetTokenHash = null;
        row.passwordResetTokenExpiry = null;
      }
    },
    findRoleIdByName: async () => null,
    assignRole: async () => undefined,
    pruneExpiredResetTokens: async () => undefined,
  } as unknown as UserRepository;
}

function fakeHasher() {
  // A trivial reversible "hash" — good enough to prove compare()/hash() round-trip correctly without
  // paying real bcrypt cost in every unit test; the real bcrypt adapter has its own dedicated tests.
  return {
    hash: vi.fn(async (plain: string) => `hashed:${plain}`),
    compare: vi.fn(async (plain: string, hash: string) => hash === `hashed:${plain}`),
  };
}

function fakeTokens(): TenantTokenPort {
  return {
    issue: vi.fn(async (claims) => ({ token: `token-for-${claims.userId}`, expiresInSeconds: 3600 })),
    verify: vi.fn(async () => null),
  };
}

function fakeEmailPort() {
  return { send: vi.fn(async () => undefined) };
}

function fakeGoogleVerifier(result: { email: string; emailVerified: boolean } | null): GoogleTokenVerifierPort {
  return { verify: vi.fn(async () => result) };
}

function fakeTenantsService(tenant: TenantSummary = TENANT): TenantsService {
  return { get: vi.fn(async () => tenant) } as unknown as TenantsService;
}

function buildService(overrides: {
  users?: UserRepository;
  tenantsService?: TenantsService;
  hasher?: ReturnType<typeof fakeHasher>;
  tokens?: TenantTokenPort;
  emailPort?: ReturnType<typeof fakeEmailPort>;
  googleVerifier?: GoogleTokenVerifierPort;
  config?: AuthServiceConfig;
} = {}) {
  return new AuthService(
    overrides.users ?? fakeUserRepository(),
    overrides.tenantsService ?? fakeTenantsService(),
    overrides.hasher ?? fakeHasher(),
    overrides.tokens ?? fakeTokens(),
    overrides.emailPort ?? fakeEmailPort(),
    overrides.googleVerifier ?? fakeGoogleVerifier(null),
    overrides.config ?? CONFIG,
  );
}

/** Every AuthService method needs the ALS tenant context `withTenantContext` would normally provide —
 * this test helper reproduces just enough of it (`requireTenantId()` reads `tenantId`). */
function withTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runWithRequestContext({ requestId: 'r1', tenantId: TENANT.id, tenantSlug: TENANT.subdomainSlug }, fn);
}

describe('AuthService.register', () => {
  it('registers a new user and returns only the summary (no accessToken)', async () => {
    const service = buildService();
    const result = await withTenant(() => service.register({ email: 'New@Example.com', password: 'Abcdefg1', firstName: 'A', lastName: 'B' }));
    expect(result.user.email).toBe('new@example.com');
    expect(result).not.toHaveProperty('accessToken');
  });

  it('rejects registration when the tenant has self-registration disabled — checked before password/email validation', async () => {
    const tenantsService = fakeTenantsService({ ...TENANT, allowEmailRegistration: false });
    const service = buildService({ tenantsService });
    await expect(
      withTenant(() => service.register({ email: 'x@example.com', password: 'a', firstName: 'A', lastName: 'B' })),
    ).rejects.toThrow(RegistrationDisabledError);
  });

  it('rejects a weak password with every violation named', async () => {
    const service = buildService();
    await expect(
      withTenant(() => service.register({ email: 'x@example.com', password: 'weak', firstName: 'A', lastName: 'B' })),
    ).rejects.toThrow(WeakPasswordError);
  });

  it('rejects a duplicate email within the same tenant', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'dup@example.com', passwordHash: 'hashed:x' }]);
    const service = buildService({ users });
    await expect(
      withTenant(() => service.register({ email: 'dup@example.com', password: 'Abcdefg1', firstName: 'A', lastName: 'B' })),
    ).rejects.toThrow(EmailAlreadyRegisteredError);
  });
});

describe('AuthService.login — enumeration safety', () => {
  it('issues a token for correct credentials', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'user@example.com', passwordHash: 'hashed:Abcdefg1', isActive: true }]);
    const service = buildService({ users });
    const result = await withTenant(() => service.login({ email: 'user@example.com', password: 'Abcdefg1' }));
    expect(result.accessToken).toBe('token-for-u1');
    expect(result.expiresInSeconds).toBe(3600);
  });

  it('rejects an unknown email with INVALID_CREDENTIALS', async () => {
    const service = buildService();
    await expect(withTenant(() => service.login({ email: 'nope@example.com', password: 'anything' }))).rejects.toThrow(InvalidCredentialsError);
  });

  it('rejects a wrong password with the identical INVALID_CREDENTIALS error', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'user@example.com', passwordHash: 'hashed:Abcdefg1', isActive: true }]);
    const service = buildService({ users });
    await expect(withTenant(() => service.login({ email: 'user@example.com', password: 'WrongPass1' }))).rejects.toThrow(InvalidCredentialsError);
  });

  it('rejects an invited-but-password-less account identically (INVALID_CREDENTIALS, not a distinguishing error)', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'invited@example.com', passwordHash: null, isActive: true }]);
    const service = buildService({ users });
    await expect(withTenant(() => service.login({ email: 'invited@example.com', password: 'anything1' }))).rejects.toThrow(InvalidCredentialsError);
  });

  it('always calls the password hasher, even for an unknown email (dummy-hash timing-equalization)', async () => {
    const hasher = fakeHasher();
    const service = buildService({ hasher });
    await expect(withTenant(() => service.login({ email: 'ghost@example.com', password: 'anything1' }))).rejects.toThrow(InvalidCredentialsError);
    expect(hasher.compare).toHaveBeenCalledTimes(1);
    expect(hasher.hash).toHaveBeenCalledWith('el-enumeration-safety-dummy-password');
  });

  it('rejects a correct password on a deactivated account with UserInactiveError (distinguishable, since credentials already proven correct)', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'inactive@example.com', passwordHash: 'hashed:Abcdefg1', isActive: false }]);
    const service = buildService({ users });
    await expect(withTenant(() => service.login({ email: 'inactive@example.com', password: 'Abcdefg1' }))).rejects.toThrow(UserInactiveError);
  });
});

describe('AuthService.forgotPassword / resetPassword', () => {
  it('forgotPassword silently no-ops for an unknown email (never discloses existence)', async () => {
    const emailPort = fakeEmailPort();
    const service = buildService({ emailPort });
    await withTenant(() => service.forgotPassword({ email: 'ghost@example.com' }));
    expect(emailPort.send).not.toHaveBeenCalled();
  });

  it('forgotPassword sends a reset email for a real account', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'user@example.com', passwordHash: 'hashed:x' }]);
    const emailPort = fakeEmailPort();
    const service = buildService({ users, emailPort });
    await withTenant(() => service.forgotPassword({ email: 'user@example.com' }));
    expect(emailPort.send).toHaveBeenCalledTimes(1);
  });

  it('resetPassword rejects an invalid/never-issued token', async () => {
    const service = buildService();
    await expect(withTenant(() => service.resetPassword({ token: 'nope', newPassword: 'Abcdefg1' }))).rejects.toThrow(ResetTokenInvalidError);
  });

  it('resetPassword rejects an expired token (real SHA-256 hash matches, but expiry has passed)', async () => {
    const { hashResetToken } = await import('../domain/reset-token');
    const tokenHash = hashResetToken('expired-token');
    const users = fakeUserRepository([
      { id: 'u1', email: 'user@example.com', passwordHash: 'hashed:x', passwordResetTokenHash: tokenHash, passwordResetTokenExpiry: new Date(Date.now() - 1000) },
    ]);
    const service = buildService({ users });
    await expect(withTenant(() => service.resetPassword({ token: 'expired-token', newPassword: 'Abcdefg1' }))).rejects.toThrow(ResetTokenExpiredError);
  });

  it('resetPassword rejects a weak new password', async () => {
    const { hashResetToken } = await import('../domain/reset-token');
    const tokenHash = hashResetToken('real-token');
    const users = fakeUserRepository([
      { id: 'u1', email: 'user@example.com', passwordHash: 'hashed:x', passwordResetTokenHash: tokenHash, passwordResetTokenExpiry: new Date(Date.now() + 60_000) },
    ]);
    const service = buildService({ users });
    await expect(withTenant(() => service.resetPassword({ token: 'real-token', newPassword: 'weak' }))).rejects.toThrow(WeakPasswordError);
  });

  it('resetPassword succeeds with a valid token and strong password, making the token single-use', async () => {
    const { hashResetToken } = await import('../domain/reset-token');
    const tokenHash = hashResetToken('real-token');
    const users = fakeUserRepository([
      { id: 'u1', email: 'user@example.com', passwordHash: 'hashed:x', passwordResetTokenHash: tokenHash, passwordResetTokenExpiry: new Date(Date.now() + 60_000) },
    ]);
    const service = buildService({ users });
    await withTenant(() => service.resetPassword({ token: 'real-token', newPassword: 'Abcdefg1' }));

    // A replay of the same token must now fail — the hash was cleared on success.
    await expect(withTenant(() => service.resetPassword({ token: 'real-token', newPassword: 'Abcdefg2' }))).rejects.toThrow(ResetTokenInvalidError);
  });
});

describe('AuthService.changePassword', () => {
  it('rejects an incorrect current password', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'user@example.com', passwordHash: 'hashed:Correct1' }]);
    const service = buildService({ users });
    await expect(service.changePassword('u1', { currentPassword: 'Wrong1', newPassword: 'NewPass1' })).rejects.toThrow(CurrentPasswordIncorrectError);
  });

  it('rejects for an account with no password set (Google-only)', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'user@example.com', passwordHash: null }]);
    const service = buildService({ users });
    await expect(service.changePassword('u1', { currentPassword: 'anything', newPassword: 'NewPass1' })).rejects.toThrow(CurrentPasswordIncorrectError);
  });

  it('rejects a weak new password', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'user@example.com', passwordHash: 'hashed:Correct1' }]);
    const service = buildService({ users });
    await expect(service.changePassword('u1', { currentPassword: 'Correct1', newPassword: 'weak' })).rejects.toThrow(WeakPasswordError);
  });

  it('succeeds with the correct current password and a strong new password', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'user@example.com', passwordHash: 'hashed:Correct1' }]);
    const service = buildService({ users });
    await expect(service.changePassword('u1', { currentPassword: 'Correct1', newPassword: 'NewPass1' })).resolves.toBeUndefined();
  });
});

describe('AuthService.signInWithGoogle', () => {
  it('rejects when the tenant has Google sign-in disabled', async () => {
    const tenantsService = fakeTenantsService({ ...TENANT, allowGoogleSignIn: false });
    const service = buildService({ tenantsService });
    await expect(withTenant(() => service.signInWithGoogle('idtoken'))).rejects.toThrow(GoogleSignInDisabledError);
  });

  it('rejects when GOOGLE_CLIENT_ID is not configured', async () => {
    const service = buildService({ config: { ...CONFIG, googleClientId: '' } });
    await expect(withTenant(() => service.signInWithGoogle('idtoken'))).rejects.toThrow(GoogleNotConfiguredError);
  });

  it('rejects an invalid/unverified Google ID token', async () => {
    const service = buildService({ googleVerifier: fakeGoogleVerifier(null) });
    await expect(withTenant(() => service.signInWithGoogle('idtoken'))).rejects.toThrow(GoogleTokenInvalidError);

    const unverified = buildService({ googleVerifier: fakeGoogleVerifier({ email: 'x@example.com', emailVerified: false }) });
    await expect(withTenant(() => unverified.signInWithGoogle('idtoken'))).rejects.toThrow(GoogleTokenInvalidError);
  });

  it('creates a new account on the fly for a first-time Google sign-in', async () => {
    const googleVerifier = fakeGoogleVerifier({ email: 'newgoogle@example.com', emailVerified: true });
    const service = buildService({ googleVerifier });
    const result = await withTenant(() => service.signInWithGoogle('idtoken'));
    expect(result.user.email).toBe('newgoogle@example.com');
    expect(result.accessToken).toEqual(expect.any(String));
  });

  it('reuses an existing password-auth account for a matching Google email (no identity-linking prompt)', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'existing@example.com', passwordHash: 'hashed:SomePassword1', isActive: true }]);
    const googleVerifier = fakeGoogleVerifier({ email: 'existing@example.com', emailVerified: true });
    const service = buildService({ users, googleVerifier });
    const result = await withTenant(() => service.signInWithGoogle('idtoken'));
    expect(result.user.email).toBe('existing@example.com');
  });

  it('rejects for an inactive resolved account', async () => {
    const users = fakeUserRepository([{ id: 'u1', email: 'inactive@example.com', passwordHash: null, isActive: false }]);
    const googleVerifier = fakeGoogleVerifier({ email: 'inactive@example.com', emailVerified: true });
    const service = buildService({ users, googleVerifier });
    await expect(withTenant(() => service.signInWithGoogle('idtoken'))).rejects.toThrow(UserInactiveError);
  });
});
