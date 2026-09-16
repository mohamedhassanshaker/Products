/**
 * Composition helpers for the `/iam` route's Server Component page and Server Actions —
 * real adapters, constructed fresh per call. Matches `settings/appearance/actions.ts`'s own
 * `function manager()` precedent: these are thin, stateless wrappers over the already-cached
 * `getPlatformDb()`/`getTenantDb()`/`getTenantCache()` clients (`tenant-db.ts`/`tenant-
 * cache.ts` own the actual pooling), so there is nothing to gain from caching the wrapper
 * object itself, and a fresh one per call keeps this file trivially simple.
 */

import { loadConfig } from "../../../../modules/platform/config.js";
import type { Clock } from "../../../../modules/platform/ports/provisioning.js";
import { PrismaRoleRepository } from "../../../../modules/iam/adapters/outbound/sql/prisma-role-repository.js";
import { PrismaTeamRepository } from "../../../../modules/iam/adapters/outbound/sql/prisma-team-repository.js";
import { PrismaUserRepository } from "../../../../modules/iam/adapters/outbound/sql/prisma-user-repository.js";
import { PrismaSecurityPolicyRepository } from "../../../../modules/iam/adapters/outbound/sql/prisma-security-policy-repository.js";
import { RedisSessionStore } from "../../../../modules/iam/adapters/outbound/redis-session-store.js";
import { identityProvider as realIdentityProvider } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import type { IdentityProvider } from "../../../../modules/iam/ports/identity-provider.js";

export function userRepository(): PrismaUserRepository {
  return new PrismaUserRepository();
}

export function teamRepository(): PrismaTeamRepository {
  return new PrismaTeamRepository();
}

export function roleRepository(): PrismaRoleRepository {
  return new PrismaRoleRepository();
}

export function sessionStore(): RedisSessionStore {
  return new RedisSessionStore();
}

export function securityPolicyRepository(): PrismaSecurityPolicyRepository {
  return new PrismaSecurityPolicyRepository();
}

/** The canonical `IdentityProvider` (`next-request-context.ts`'s own doc comment on why this is never a second, independently-constructed instance). */
export function identityProvider(): IdentityProvider {
  return realIdentityProvider();
}

export function realClock(): Clock {
  return { now: () => new Date() };
}

/** `SHJ3_ENVIRONMENT`, validated at boot (`config.ts`) — every audit entry this route writes names it. */
export function environment(): string {
  return loadConfig().environment;
}
