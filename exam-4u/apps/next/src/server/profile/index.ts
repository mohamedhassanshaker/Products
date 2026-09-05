import { getEnv } from '@/server/config';
import { requireTenantDataSource } from '@/server/context';
import { getStoragePortSingleton } from '@/server/files';
import { ProfileService } from './application/profile.service';
import { ProfileRepository } from './infrastructure/profile.repository';

export { ProfileService, ProfileRepository };
export type { ProfileSummary } from './domain/profile.types';
export { FileTooLargeError, UnsupportedImageTypeError } from './domain/errors';

/**
 * `server/profile`'s public barrel (Phase 1 sub-slice 1c, FR-IAM-4) — authenticated self-service
 * "my profile" read/update/avatar-upload, as distinct from `users`' admin-facing "manage other
 * users" surface. Nothing outside this module may import `./domain/**`/`./infrastructure/**`/
 * `./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s `profile` module-boundary
 * rule).
 *
 * {@link getProfileService} builds a fresh instance per call — its `ProfileRepository` needs the
 * *current request's* tenant-scoped `DataSource` (must only ever be called from inside a
 * `withTenantContext`-wrapped Route Handler), matching `server/auth`/`server/rbac`'s identical
 * composition-root convention.
 */
export function getProfileService(): ProfileService {
  const env = getEnv();
  const dataSource = requireTenantDataSource();
  return new ProfileService(
    { maxAvatarSizeBytes: env.MAX_AVATAR_SIZE_BYTES },
    new ProfileRepository(dataSource),
    getStoragePortSingleton(),
  );
}
