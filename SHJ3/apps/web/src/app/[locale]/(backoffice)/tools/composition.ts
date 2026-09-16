/**
 * Composition helpers for the `/tools` route's Server Component page and Server Actions —
 * real adapters, constructed fresh per call. Identical precedent to `iam/composition.ts`
 * and `agents/composition.ts`: every one of these is a thin, stateless wrapper over the
 * already-cached `getTenantDb()`/`getTenantCache()` clients (`tenant-db.ts`/`tenant-cache.ts`
 * own the actual pooling), so there is nothing to gain from caching the wrapper object
 * itself, and a fresh one per call keeps this file trivially simple.
 *
 * This is the composition root for B5 — the one place in this route allowed to name concrete
 * adapters. Every use case below it receives ports only (architecture.md §4's swap test), so
 * replacing SQL Server with anything else, or Redis breaker state with anything else, never
 * reaches `page.tsx`/`actions.ts`.
 */

import { PrismaApiConnectorRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-api-connector-repository.js";
import { PrismaCircuitBreakerRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-circuit-breaker-repository.js";
import { PrismaMcpServerRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-mcp-server-repository.js";
import { PrismaSkillRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-skill-repository.js";
import { PrismaToolBindingRepository } from "../../../../modules/tools/adapters/outbound/sql/prisma-tool-binding-repository.js";
import { AiServiceMcpDiscoveryClient } from "../../../../modules/tools/adapters/outbound/ai/ai-service-mcp-discovery-client.js";
import { RedisCircuitBreakerStateStore } from "../../../../modules/tools/adapters/outbound/cache/redis-circuit-breaker-state-store.js";

export function skillRepository(): PrismaSkillRepository {
  return new PrismaSkillRepository();
}

export function mcpServerRepository(): PrismaMcpServerRepository {
  return new PrismaMcpServerRepository();
}

export function apiConnectorRepository(): PrismaApiConnectorRepository {
  return new PrismaApiConnectorRepository();
}

export function toolBindingRepository(): PrismaToolBindingRepository {
  return new PrismaToolBindingRepository();
}

export function circuitBreakerRepository(): PrismaCircuitBreakerRepository {
  return new PrismaCircuitBreakerRepository();
}

/** Redis-backed, so a tripped breaker is one fact shared by every web replica — not per-process memory. */
export function circuitBreakerStateStore(): RedisCircuitBreakerStateStore {
  return new RedisCircuitBreakerStateStore();
}

/**
 * The real (documented as not-yet-reachable) MCP discovery seam. `apps/ai` owns the actual
 * MCP client; this adapter calls its internal endpoint, which does not exist yet — so a real
 * "Connect & discover" click resolves `ai_runtime_unavailable`, which `mcp-servers-tab.tsx`
 * surfaces verbatim rather than disguising as a handshake failure.
 */
export function mcpDiscoveryClient(): AiServiceMcpDiscoveryClient {
  return new AiServiceMcpDiscoveryClient();
}

/**
 * The wall clock every `modules/tools` use case takes as a plain `now: Date` input.
 *
 * Deliberately not the `Clock` port `iam/composition.ts` exports: `modules/iam`'s use cases
 * accept a `Clock` dependency, `modules/tools`' accept a `Date` field on their input — one
 * helper matching the contract that actually exists beats a port shape nothing here consumes.
 */
export function now(): Date {
  return new Date();
}
