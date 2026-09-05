import { randomUUID } from 'node:crypto';
import { getRequestContext, requireTenantId } from '@/server/context';
import { InternalDomainError } from '@/server/common/errors/domain-error';
import type { PasswordHasherPort } from '@/server/common/ports/password-hasher.port';
import { escapeHtml, renderBrandedEmail } from '@/server/infrastructure/mail';
import type { EmailPort } from '@/server/tenancy';
import type { TenantsService } from '@/server/platform/tenants';
import { evaluatePasswordPolicy } from '../domain/password-policy';
import { generateResetToken, hashResetToken } from '../domain/reset-token';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LoginResult,
  PasswordPolicy,
  RegisterInput,
  RegisterResult,
  ResetPasswordInput,
  UserSummary,
} from '../domain/auth.types';
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
import type { GoogleTokenVerifierPort } from '../domain/ports/google-token-verifier.port';
import type { TenantTokenPort } from '../domain/ports/tenant-token.port';
import type { UserEntity } from '@/server/infrastructure/database';
import type { UserRepository } from '../infrastructure/user.repository';

/** A real password never used for login — hashed once (lazily, memoized for the process lifetime) so
 * an unknown-email login attempt pays the identical bcrypt cost as a real one (timing/enumeration
 * mitigation). Ported verbatim literal from legacy. */
const DUMMY_PASSWORD = 'el-enumeration-safety-dummy-password';

/** Config primitives bundled into one object (rather than four separate constructor params) — pure
 * data, not a collaborator, so it doesn't count against the "≤4-5 collaborators" guideline the way a
 * 10th constructor parameter would. */
export interface AuthServiceConfig {
  passwordPolicy: PasswordPolicy;
  resetTokenTtlMinutes: number;
  googleClientId: string;
  defaultAccentColor: string;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function toSummary(user: UserEntity): UserSummary {
  return { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName };
}

/**
 * Tenant-realm authentication — ported logic (not code) from
 * `legacy/api/src/modules/auth/application/auth.service.ts`'s `AuthService`. Every method that needs
 * "the current tenant" reads it via `requireTenantId()` (this app's `getRequestContext()?.tenantId`
 * equivalent) — always populated by `withTenantContext` before any Route Handler body runs, so a
 * missing tenant id here is a genuine programmer error (`InternalDomainError`), never a client-facing
 * condition, exactly matching legacy's own defensive-assertion framing.
 */
export class AuthService {
  private dummyHashPromise?: Promise<string>;

  constructor(
    private readonly users: UserRepository,
    private readonly tenantsService: TenantsService,
    private readonly hasher: PasswordHasherPort,
    private readonly tokens: TenantTokenPort,
    private readonly emailPort: EmailPort,
    private readonly googleVerifier: GoogleTokenVerifierPort,
    private readonly config: AuthServiceConfig,
  ) {}

  /**
   * @throws {RegistrationDisabledError} if the current tenant has self-registration turned off —
   *   checked first, before any other validation, so a disabled tenant never leaks a different reason.
   * @throws {WeakPasswordError} if the password fails the configured policy.
   * @throws {EmailAlreadyRegisteredError} if `email` is already registered in this tenant.
   */
  async register(input: RegisterInput): Promise<RegisterResult> {
    const email = normalizeEmail(input.email);
    const tenant = await this.currentTenant();

    if (!tenant.allowEmailRegistration) {
      throw new RegistrationDisabledError();
    }

    const violations = evaluatePasswordPolicy(input.password, this.config.passwordPolicy);
    if (violations.length > 0) {
      throw new WeakPasswordError(violations);
    }

    if (await this.users.findByEmail(email)) {
      throw new EmailAlreadyRegisteredError();
    }

    const passwordHash = await this.hasher.hash(input.password);
    const created = await this.users.insert({
      id: randomUUID(),
      email,
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      passwordHash,
      isActive: true,
    });

    await this.assignDefaultRoleIfConfigured(created.id);

    // Deliberately no token issued here — matches legacy's `RegisterResult` shape (`{ user }` only);
    // the client calls `login()` next.
    return { user: toSummary(created) };
  }

  /**
   * Enumeration-safe: unknown email, wrong password, and an invited-but-password-less account
   * (`passwordHash === null`) all reject identically.
   *
   * @throws {InvalidCredentialsError} for any of the three cases above.
   * @throws {UserInactiveError} only once credentials are already proven correct.
   */
  async login(input: LoginInput): Promise<LoginResult> {
    const email = normalizeEmail(input.email);
    const user = await this.users.findByEmail(email);

    const hashToCompare = user?.passwordHash ?? (await this.dummyHash());
    const passwordMatches = await this.hasher.compare(input.password, hashToCompare);

    if (!user || !user.passwordHash || !passwordMatches) {
      throw new InvalidCredentialsError();
    }
    if (!user.isActive) {
      throw new UserInactiveError();
    }

    await this.users.updateLastLogin(user.id, new Date());

    const { tenantId, tenantSlug } = this.currentTenantIdentity('login');
    const { token, expiresInSeconds } = await this.tokens.issue({ userId: user.id, tenantId, tenantSlug });
    return { accessToken: token, expiresInSeconds, user: toSummary(user) };
  }

  /** Always resolves — never discloses whether `input.email` has an account in this tenant. */
  async forgotPassword(input: ForgotPasswordInput): Promise<void> {
    const email = normalizeEmail(input.email);
    const user = await this.users.findByEmail(email);
    if (!user) return;

    const { token, tokenHash, expiresAt } = generateResetToken(this.config.resetTokenTtlMinutes);
    await this.users.setResetToken(user.id, tokenHash, expiresAt);

    const tenant = await this.currentTenant();
    const safeToken = escapeHtml(token);
    const { subject, html } = renderBrandedEmail({
      tenantName: tenant.name,
      tenantLogoUrl: tenant.logoUrl,
      accentColor: tenant.accentColorOverride ?? this.config.defaultAccentColor,
      subject: 'Reset your password',
      bodyHtml:
        `<p>Use this code to reset your password (expires in ${this.config.resetTokenTtlMinutes} minutes):</p>` +
        `<p style="font-size:20px;font-weight:bold;letter-spacing:2px;">${safeToken}</p>`,
    });

    // An email-send failure must never fail this always-200 request — `EmailPort.send()` already
    // promises never to throw, but the defensive `.catch` matches legacy's own belt-and-braces call.
    await this.emailPort
      .send({
        to: user.email,
        subject,
        html,
        text: `Use this code to reset your password (expires in ${this.config.resetTokenTtlMinutes} minutes): ${token}`,
      })
      .catch(() => undefined);
  }

  /**
   * @throws {ResetTokenInvalidError} if `token` was never issued, already consumed, or belongs to a
   *   different tenant's schema.
   * @throws {ResetTokenExpiredError} if the token's expiry has passed.
   * @throws {WeakPasswordError} if `newPassword` fails the configured policy.
   */
  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const tokenHash = hashResetToken(input.token);
    const user = await this.users.findByResetTokenHash(tokenHash);
    if (!user) {
      throw new ResetTokenInvalidError();
    }
    if (!user.passwordResetTokenExpiry || user.passwordResetTokenExpiry.getTime() < Date.now()) {
      throw new ResetTokenExpiredError();
    }

    const violations = evaluatePasswordPolicy(input.newPassword, this.config.passwordPolicy);
    if (violations.length > 0) {
      throw new WeakPasswordError(violations);
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    // Also atomically clears the reset-token fields — makes the token single-use.
    await this.users.setPasswordHash(user.id, passwordHash);
  }

  /**
   * @throws {CurrentPasswordIncorrectError} if `currentPassword` doesn't match (or the account has no
   *   password set at all, e.g. Google-only).
   * @throws {WeakPasswordError} if `newPassword` fails the configured policy.
   */
  async changePassword(userId: string, input: ChangePasswordInput): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      // Only reachable via a hard-delete race between token issuance and this call — an ops/
      // programmer edge case, never client-facing.
      throw new InternalDomainError(new Error('changePassword() called for a user that no longer exists.'));
    }

    const currentMatches = user.passwordHash ? await this.hasher.compare(input.currentPassword, user.passwordHash) : false;
    if (!currentMatches) {
      throw new CurrentPasswordIncorrectError();
    }

    const violations = evaluatePasswordPolicy(input.newPassword, this.config.passwordPolicy);
    if (violations.length > 0) {
      throw new WeakPasswordError(violations);
    }

    const passwordHash = await this.hasher.hash(input.newPassword);
    await this.users.setPasswordHash(user.id, passwordHash);
  }

  /**
   * @throws {GoogleSignInDisabledError} if the current tenant has Google sign-in turned off.
   * @throws {GoogleNotConfiguredError} if `GOOGLE_CLIENT_ID` is unset server-side.
   * @throws {GoogleTokenInvalidError} if the ID token fails verification or its email is unverified.
   * @throws {UserInactiveError} if the resolved/created account is inactive.
   */
  async signInWithGoogle(idToken: string): Promise<LoginResult> {
    const tenant = await this.currentTenant();
    if (!tenant.allowGoogleSignIn) {
      throw new GoogleSignInDisabledError();
    }
    if (!this.config.googleClientId) {
      throw new GoogleNotConfiguredError();
    }

    const identity = await this.googleVerifier.verify(idToken, this.config.googleClientId);
    if (!identity || !identity.emailVerified) {
      throw new GoogleTokenInvalidError();
    }

    const email = normalizeEmail(identity.email);
    let user = await this.users.findByEmail(email);
    if (!user) {
      // Find-or-create on the fly — no separate identity-linking step or conflict prompt, even if an
      // account with this email already exists via password auth (deliberate: the ID token is already
      // cryptographically verified by Google, so there's no enumeration-safety concern here the way
      // there is for `login()`).
      user = await this.users.insert({
        id: randomUUID(),
        email,
        firstName: 'Google',
        lastName: 'User',
        passwordHash: null,
        isActive: true,
      });
      await this.assignDefaultRoleIfConfigured(user.id);
    }

    if (!user.isActive) {
      throw new UserInactiveError();
    }

    await this.users.updateLastLogin(user.id, new Date());

    const { tenantId, tenantSlug } = this.currentTenantIdentity('signInWithGoogle');
    const { token, expiresInSeconds } = await this.tokens.issue({ userId: user.id, tenantId, tenantSlug });
    return { accessToken: token, expiresInSeconds, user: toSummary(user) };
  }

  /** Best-effort: assigns the tenant's configured self-register default role, if any. A vanished
   * tenant mid-request is swallowed (not a reason to fail an already-successful registration); a
   * missing/misconfigured role name is silently skipped. */
  private async assignDefaultRoleIfConfigured(userId: string): Promise<void> {
    let tenant;
    try {
      tenant = await this.currentTenant();
    } catch {
      return;
    }
    if (!tenant.defaultSelfRegisterRole) return;

    const roleId = await this.users.findRoleIdByName(tenant.defaultSelfRegisterRole);
    if (roleId === null) return;
    await this.users.assignRole(userId, roleId);
  }

  private async currentTenant() {
    return this.tenantsService.get(requireTenantId());
  }

  /** `login()`/`signInWithGoogle()` both need `tenantId`/`tenantSlug` to embed in the token — reads
   * both straight from the ALS context (already populated by `withTenantContext`) rather than a
   * second `tenantsService.get()` round-trip. */
  private currentTenantIdentity(caller: string): { tenantId: string; tenantSlug: string } {
    const ctx = getRequestContext();
    if (!ctx?.tenantId || !ctx.tenantSlug) {
      throw new InternalDomainError(new Error(`${caller}() called outside any resolved tenant scope.`));
    }
    return { tenantId: ctx.tenantId, tenantSlug: ctx.tenantSlug };
  }

  private dummyHash(): Promise<string> {
    if (!this.dummyHashPromise) {
      this.dummyHashPromise = this.hasher.hash(DUMMY_PASSWORD);
    }
    return this.dummyHashPromise;
  }
}
