import { getPlatformDataSource } from '@/server/infrastructure/database';
import { TenantsService } from './application/tenants.service';
import { PlatformTenantRepository } from './infrastructure/tenant.repository';

export { TenantsService, PlatformTenantRepository };
export type {
  BrandingSummary,
  CreateTenantInput,
  ListTenantsOptions,
  ListTenantsResult,
  TenantSummary,
  UpdateBrandingInput,
} from './domain/tenant.types';
export type { ResolvedTenant, FindManyOptions } from './infrastructure/tenant.repository';
export {
  InsufficientColorContrastError,
  InvalidColorFormatError,
  InvalidSubdomainError,
  InvalidTenantStateError,
  SubdomainTakenError,
  TenantNameRequiredError,
  TenantNotFoundError,
} from './domain/errors';

/**
 * `server/platform/tenants`'s public barrel. Nothing outside this module may import
 * `./domain/**`/`./infrastructure/**`/`./application/**` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `platform/tenants` module-boundary rule) — every consumer (including
 * `server/platform/provisioning`) goes through this barrel.
 *
 * {@link getTenantsService} is the composition root other modules use to obtain a ready-to-use
 * {@link TenantsService} without each caller re-deriving "resolve the platform `DataSource`, then
 * construct the repository, then construct the service" themselves. Cached on `globalThis` for the
 * same Next.js dev-hot-reload reason every other async singleton in this app is.
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandTenantsService: Promise<TenantsService> | undefined;
}

export async function getTenantsService(): Promise<TenantsService> {
  if (!globalThis.__examlandTenantsService) {
    globalThis.__examlandTenantsService = getPlatformDataSource().then(
      (ds) => new TenantsService(new PlatformTenantRepository(ds)),
    );
  }
  return globalThis.__examlandTenantsService;
}
