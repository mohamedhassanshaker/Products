import { getEnv } from '@/server/config';
import { createStoragePort } from '@/server/infrastructure/storage';
import { FileSigningService } from './application/file-signing.service';
import { parseRangeHeader } from './application/range.util';

export { FileSigningService, parseRangeHeader };
export type { VerifiedDownload, FileSigningServiceConfig } from './application/file-signing.service';
export { LinkInvalidOrExpiredError, PathTraversalRejectedError, StorageKeyNotOwnedError } from './domain/errors';

/**
 * `server/files`'s public barrel (Phase 1 sub-slice 1c, FR-FILE-1/FR-FILE-2) — HMAC-signed,
 * expiry-bounded file delivery. Nothing outside this module may import `./domain/**`/
 * `./application/**` directly (enforced by `apps/next/.eslintrc.cjs`'s `files` module-boundary rule).
 *
 * {@link getFileSigningService}/{@link getStoragePortSingleton} are the composition roots — cheap to
 * reconstruct per call (no per-request tenant `DataSource` dependency, unlike `auth`/`rbac`'s
 * composition functions), but the storage port is still cached on `globalThis` since constructing it
 * has no per-call reason to differ (same pattern as every other process-wide singleton in this app).
 */
declare global {
  // eslint-disable-next-line no-var -- global augmentation requires `var`, not `const`/`let`.
  var __examlandStoragePort: ReturnType<typeof createStoragePort> | undefined;
}

export function getStoragePortSingleton(): ReturnType<typeof createStoragePort> {
  if (!globalThis.__examlandStoragePort) {
    const env = getEnv();
    globalThis.__examlandStoragePort = createStoragePort(env.STORAGE_DRIVER, env.STORAGE_ROOT);
  }
  return globalThis.__examlandStoragePort;
}

export function getFileSigningService(): FileSigningService {
  const env = getEnv();
  return new FileSigningService(
    { signingSecret: env.FILE_SIGNING_SECRET, signedUrlTtlSec: env.SIGNED_URL_TTL_SEC },
    getStoragePortSingleton(),
  );
}
