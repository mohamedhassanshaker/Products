import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { createEmailPort } from '@/server/infrastructure/mail';
import { BcryptPasswordHasherAdapter, JwtTenantTokenAdapter, GoogleIdTokenVerifierAdapter } from '@/server/infrastructure/security';
import { getTenantsService } from '@/server/platform/tenants';
import { requireTenantDataSource } from '@/server/context';
import { AuthService, type AuthServiceConfig } from './application/auth.service';
import { UserRepository } from './infrastructure/user.repository';
import { requireTenantUser } from './api/require-tenant-user';
import { evaluatePasswordPolicy } from './domain/password-policy';

export { AuthService, UserRepository, requireTenantUser, evaluatePasswordPolicy };
export type { AuthServiceConfig };
export type {
  AuthenticatedTenantUser,
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  LoginResult,
  PasswordPolicy,
  RegisterInput,
  RegisterResult,
  ResetPasswordInput,
  UserSummary,
} from './domain/auth.types';
export {
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
} from './domain/errors';
export type { GoogleTokenVerifierPort, VerifiedGoogleIdentity } from './domain/ports/google-token-verifier.port';
export type { DecodedTenantToken, IssuedTenantToken, TenantTokenPort } from './domain/ports/tenant-token.port';

/**
 * `server/auth`'s public barrel (Phase 1 sub-slice 1b) — tenant-realm authentication (dual-realm JWT
 * per the migration plan; this is the tenant half, `server/platform/auth` is the platform-admin
 * half). Nothing outside this module may import `./domain/**`/`./infrastructure/**`/`./application/**`/
 * `./api/**` directly (enforced by `apps/next/.eslintrc.cjs`'s `auth` module-boundary rule).
 *
 * {@link getAuthService} is the composition root: builds a fresh {@link AuthService} per call, since
 * its `UserRepository` collaborator needs the *current request's* tenant-scoped `DataSource`
 * (`requireTenantDataSource()`, populated by `withTenantContext` — this function must therefore only
 * ever be called from inside a `withTenantContext`-wrapped Route Handler). The other collaborators
 * (password hasher, tenant-token adapter, email port, Google verifier, `TenantsService`) are stateless
 * or platform-scoped, so reconstructing them per call is cheap and always reflects the current
 * `getEnv()` snapshot — no `globalThis` caching needed here the way genuinely expensive/stateful
 * singletons (the tenant `DataSource` registry itself) require.
 */
export async function getAuthService(): Promise<AuthService> {
  const env = getEnv();
  const tenantsService = await getTenantsService();

  const config: AuthServiceConfig = {
    passwordPolicy: {
      minLength: env.PASSWORD_MIN_LENGTH,
      requireUpper: env.PASSWORD_REQUIRE_UPPER,
      requireLower: env.PASSWORD_REQUIRE_LOWER,
      requireDigit: env.PASSWORD_REQUIRE_DIGIT,
      requireSymbol: env.PASSWORD_REQUIRE_SYMBOL,
    },
    resetTokenTtlMinutes: env.RESET_TOKEN_TTL_MIN,
    googleClientId: env.GOOGLE_CLIENT_ID,
    defaultAccentColor: env.THEME_DEFAULT_ACCENT_COLOR,
  };

  return new AuthService(
    new UserRepository(requireTenantDataSource()),
    tenantsService,
    new BcryptPasswordHasherAdapter(env.BCRYPT_COST),
    new JwtTenantTokenAdapter(env.JWT_TENANT_SECRET, env.JWT_TENANT_TTL),
    createEmailPort(logger),
    new GoogleIdTokenVerifierAdapter(),
    config,
  );
}
