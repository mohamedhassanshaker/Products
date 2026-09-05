import type { PasswordHasherPort } from '@/server/common/ports/password-hasher.port';
import { PlatformInvalidCredentialsError } from '../domain/errors';
import type { PlatformAdminSummary, PlatformLoginInput, PlatformLoginResult } from '../domain/platform-admin.types';
import type { PlatformAdminTokenPort } from '../domain/ports/platform-admin-token.port';
import type { PlatformAdminRepository } from '../infrastructure/platform-admin.repository';
import type { PlatformAdminEntity } from '@/server/infrastructure/database';

/** A real password never used for login — hashed once (lazily memoized) so an unknown-email login
 * attempt pays the identical bcrypt cost as a real one. Ported verbatim literal from legacy — a
 * deliberately distinct literal from the tenant realm's own dummy password, even though both serve
 * the identical purpose, since the two services never share any state. */
const DUMMY_PASSWORD = 'el-platform-enumeration-safety-dummy-password';

function toSummary(admin: PlatformAdminEntity): PlatformAdminSummary {
  return { id: admin.id, email: admin.email, name: admin.name, isActive: admin.isActive, lastLoginAt: admin.lastLoginAt, createdAt: admin.createdAt };
}

/**
 * Platform-admin authentication — ported logic (not code) from
 * `legacy/api/src/platform/auth/application/platform-admin-auth.service.ts`'s
 * `PlatformAdminAuthService`. No tenant concept anywhere in this class — a Platform Admin has "a
 * single implicit super-scope."
 */
export class PlatformAdminAuthService {
  private dummyHashPromise?: Promise<string>;

  constructor(
    private readonly admins: PlatformAdminRepository,
    private readonly hasher: PasswordHasherPort,
    private readonly tokens: PlatformAdminTokenPort,
  ) {}

  /**
   * Single rejection path, no distinct branches by cause (ported verbatim enumeration-safety
   * property): unknown email, wrong password, and a deactivated (`isActive === false`) admin **even
   * with the correct password** all throw the identical {@link PlatformInvalidCredentialsError} — a
   * deactivated account is never distinguishable from a nonexistent one, unlike the tenant realm's
   * `login()` (which *does* distinguish `UserInactiveError` once credentials are proven correct — a
   * deliberate, documented platform-realm difference, ported faithfully rather than "fixed" to match
   * the other realm).
   *
   * @throws {PlatformInvalidCredentialsError}
   */
  async login(input: PlatformLoginInput): Promise<PlatformLoginResult> {
    const email = input.email.trim().toLowerCase();
    const admin = await this.admins.findByEmail(email);

    const hashToCompare = admin?.passwordHash ?? (await this.dummyHash());
    const passwordMatches = await this.hasher.compare(input.password, hashToCompare);

    if (!admin || !admin.isActive || !passwordMatches) {
      throw new PlatformInvalidCredentialsError();
    }

    await this.admins.updateLastLogin(admin.id, new Date());
    const { token, expiresInSeconds } = await this.tokens.issue({ adminId: admin.id });
    return { accessToken: token, expiresInSeconds, admin: toSummary(admin) };
  }

  /** `null` (not a throw) if `id` doesn't resolve to any admin — the caller (`GET /platform/auth/me`'s
   * Route Handler) decides what that means (404). */
  async getById(id: string): Promise<PlatformAdminSummary | null> {
    const admin = await this.admins.findById(id);
    return admin ? toSummary(admin) : null;
  }

  private dummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = this.hasher.hash(DUMMY_PASSWORD);
    }
    return this.dummyHashPromise;
  }
}
