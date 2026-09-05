/** Platform-admin auth domain types — ported verbatim from
 * `legacy/api/src/platform/auth/domain/platform-admin.types.ts`. */

/** Never includes `passwordHash`. */
export interface PlatformAdminSummary {
  id: string;
  email: string;
  name: string;
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

export interface PlatformLoginInput {
  email: string;
  password: string;
}

export interface PlatformLoginResult {
  accessToken: string;
  expiresInSeconds: number;
  admin: PlatformAdminSummary;
}
