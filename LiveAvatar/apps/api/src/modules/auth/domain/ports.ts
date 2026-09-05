import type { AdminIdentity, IssuedTokens } from './admin-identity';

/** Password hashing (Argon2id). */
export interface PasswordHasherPort {
  hash(plain: string): Promise<string>;
  verify(hash: string, plain: string): Promise<boolean>;
}

/** Signs admin access JWTs. Refresh tokens are opaque and stored hashed. */
export interface TokenSignerPort {
  signAccess(identity: AdminIdentity): string;
}

/** Stored refresh-token row. */
export interface RefreshTokenRecord {
  id: string;
  adminUserId: string;
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  revokedAt: Date | null;
}

/** Admin user persistence. */
export interface AdminUserRepositoryPort {
  findByEmail(email: string): Promise<AdminIdentity | null>;
  findById(id: string): Promise<AdminIdentity | null>;
  countOperators(): Promise<number>;
  create(input: {
    email: string;
    passwordHash: string;
    roles: string[];
    tenantIds: string[];
  }): Promise<AdminIdentity>;
  emailExists(email: string): Promise<boolean>;
  /**
   * Atomically creates the first operator: the "no operator yet" check and
   * the insert run inside one DB transaction serialized by a Postgres
   * advisory lock, so two concurrent `/auth/seed` calls cannot both pass the
   * count check before either commits (closes D-4 — the bootstrap "one-time"
   * guarantee was previously only a non-atomic count-then-create).
   * @returns The created operator, or null if an operator already exists.
   */
  createFirstOperator(input: { email: string; passwordHash: string }): Promise<AdminIdentity | null>;
}

/** Refresh-token persistence and family revocation (FR-AUTH-2). */
export interface RefreshTokenRepositoryPort {
  create(input: {
    adminUserId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }): Promise<void>;
  findByHash(tokenHash: string): Promise<RefreshTokenRecord | null>;
  revokeFamily(familyId: string): Promise<void>;
  revokeByHash(tokenHash: string): Promise<void>;
}

/** Login failure window: 10 fails / 10 min / IP+email → AUTH_RATE_LIMITED. */
export interface LoginRateLimiterPort {
  tooManyFailures(ip: string, email: string): Promise<boolean>;
  recordFailure(ip: string, email: string): Promise<void>;
  clear(ip: string, email: string): Promise<void>;
}

/** Opaque token hashing (refresh + invite). */
export interface TokenDigestPort {
  digest(token: string): string;
  randomToken(): string;
  randomFamilyId(): string;
}

export const PASSWORD_HASHER = Symbol('PASSWORD_HASHER');
export const TOKEN_SIGNER = Symbol('TOKEN_SIGNER');
export const ADMIN_USER_REPOSITORY = Symbol('ADMIN_USER_REPOSITORY');
export const REFRESH_TOKEN_REPOSITORY = Symbol('REFRESH_TOKEN_REPOSITORY');
export const LOGIN_RATE_LIMITER = Symbol('LOGIN_RATE_LIMITER');
export const TOKEN_DIGEST = Symbol('TOKEN_DIGEST');

export type { IssuedTokens };
