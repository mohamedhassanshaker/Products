import { getEnv } from '@/server/config';
import { logger } from '@/server/logging';
import { getPlatformDataSource } from '@/server/infrastructure/database';
import { BcryptPasswordHasherAdapter, JwtPlatformTokenAdapter } from '@/server/infrastructure/security';
import { PlatformAdminRepository } from './infrastructure/platform-admin.repository';
import { PlatformAdminAuthService } from './application/platform-admin-auth.service';
import { PlatformAdminBootstrapService } from './application/platform-admin-bootstrap.service';

export { PlatformAdminAuthService, PlatformAdminRepository, PlatformAdminBootstrapService };
export { PlatformInvalidCredentialsError } from './domain/errors';
export type { PlatformAdminSummary, PlatformLoginInput, PlatformLoginResult } from './domain/platform-admin.types';
export type { DecodedPlatformToken, IssuedPlatformToken, PlatformAdminTokenPort } from './domain/ports/platform-admin-token.port';

/**
 * `server/platform/auth`'s public barrel (Phase 1 sub-slice 1b) — the platform-admin realm half of
 * the migration plan's dual-realm JWT auth (`server/auth` is the tenant-user half). Nothing outside
 * this module may import `./domain/**`/`./infrastructure/**`/`./application/**` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `platform/auth` module-boundary rule).
 *
 * Both composition functions below are `globalThis`-cached singletons — unlike `server/auth`'s
 * `getAuthService()`, this realm's repository is bound to the single, non-tenant-scoped platform
 * `DataSource`, so there is no per-request "which tenant" variable that would force a fresh instance
 * per call.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandPlatformAdminAuthService: Promise<PlatformAdminAuthService> | undefined;
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandPlatformAdminBootstrapService: Promise<PlatformAdminBootstrapService> | undefined;
}

export async function getPlatformAdminAuthService(): Promise<PlatformAdminAuthService> {
  if (!globalThis.__examlandPlatformAdminAuthService) {
    globalThis.__examlandPlatformAdminAuthService = (async () => {
      const env = getEnv();
      const dataSource = await getPlatformDataSource();
      const admins = new PlatformAdminRepository(dataSource);
      const hasher = new BcryptPasswordHasherAdapter(env.BCRYPT_COST);
      const tokens = new JwtPlatformTokenAdapter(env.JWT_PLATFORM_SECRET, env.JWT_PLATFORM_TTL);
      return new PlatformAdminAuthService(admins, hasher, tokens);
    })();
  }
  return globalThis.__examlandPlatformAdminAuthService;
}

async function getPlatformAdminBootstrapService(): Promise<PlatformAdminBootstrapService> {
  if (!globalThis.__examlandPlatformAdminBootstrapService) {
    globalThis.__examlandPlatformAdminBootstrapService = (async () => {
      const env = getEnv();
      const dataSource = await getPlatformDataSource();
      const admins = new PlatformAdminRepository(dataSource);
      const hasher = new BcryptPasswordHasherAdapter(env.BCRYPT_COST);
      return new PlatformAdminBootstrapService(admins, hasher, logger);
    })();
  }
  return globalThis.__examlandPlatformAdminBootstrapService;
}

/**
 * Runs the idempotent Platform Admin bootstrap once — called from `instrumentation.ts`'s `register()`
 * hook (this app's equivalent of legacy's `OnApplicationBootstrap` lifecycle hook, see
 * `PlatformAdminBootstrapService`'s own doc comment).
 */
export async function runPlatformAdminBootstrap(): Promise<void> {
  const env = getEnv();
  const service = await getPlatformAdminBootstrapService();
  await service.run({ email: env.PLATFORM_ADMIN_BOOTSTRAP_EMAIL, password: env.PLATFORM_ADMIN_BOOTSTRAP_PASSWORD });
}
