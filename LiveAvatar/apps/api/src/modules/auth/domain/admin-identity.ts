/** Persisted admin identity (domain — no Prisma types). */
export interface AdminIdentity {
  id: string;
  email: string;
  passwordHash: string;
  roles: string[];
  disabled: boolean;
  tenantIds: string[];
}

/** Access + refresh pair issued after login, seed-accept, or rotation. */
export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: 28800;
}

/** Allowed admin role keys. */
export type AdminRole = 'operator' | 'admin';
