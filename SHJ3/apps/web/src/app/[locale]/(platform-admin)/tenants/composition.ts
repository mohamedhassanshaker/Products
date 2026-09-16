/**
 * Composition helpers for the `/tenants` route's Server Component page and Server
 * Actions — real adapters, constructed fresh per call. Matches `(backoffice)/iam/
 * composition.ts`'s own precedent exactly.
 */

import { loadConfig } from "../../../../modules/platform/config.js";
import type { Clock } from "../../../../modules/platform/ports/provisioning.js";
import { PrismaTenantRegistry } from "../../../../modules/platform/adapters/outbound/sql/tenant-registry.js";
import { PlatformAuditSink } from "../../../../modules/platform/adapters/outbound/sql/audit-sink.js";
import { SqlStoreProvisioner } from "../../../../modules/platform/adapters/outbound/sql/sql-store-provisioner.js";
import { RedisStoreProvisioner } from "../../../../modules/platform/adapters/outbound/cache/redis-store-provisioner.js";
import { AiGraphProvisioner } from "../../../../modules/platform/adapters/outbound/graph/ai-graph-provisioner.js";
import { AiVectorProvisioner } from "../../../../modules/platform/adapters/outbound/vector/ai-vector-provisioner.js";
import type { StoreProvisioner } from "../../../../modules/platform/ports/provisioning.js";
import { RequirePlatformOperator } from "../../../../modules/platform/application/require-platform-operator.js";
import { PrismaTenantProfileReader } from "../../../../modules/platform/adapters/outbound/sql/prisma-tenant-profile-reader.js";
import { SessionStoreTenantRevoker } from "../../../../modules/iam/adapters/outbound/session-tenant-revoker.js";
import { RedisSessionStore } from "../../../../modules/iam/adapters/outbound/redis-session-store.js";

export function tenantRegistry(): PrismaTenantRegistry {
  return new PrismaTenantRegistry();
}

export function auditSink(): PlatformAuditSink {
  return new PlatformAuditSink();
}

export function realClock(): Clock {
  return { now: () => new Date() };
}

/** `SHJ3_ENVIRONMENT`, validated at boot (`config.ts`) — every audit entry this route writes names it. */
export function environment(): string {
  return loadConfig().environment;
}

/**
 * The tenant's default embedding model/dimensions, absent an operator override in the
 * Create form — same env vars and same literal defaults `scripts/seed-iam-demo-data.ts`'s
 * own `buildProvisioners()` already reads, since `Shj3Config` (`platform/config.ts`) has
 * no field for either (this is provisioning-time input, not deployment config).
 */
export function defaultEmbeddingModel(): string {
  return process.env.SHJ3_OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-large";
}

export function defaultEmbeddingDimensions(): number {
  return Number(process.env.SHJ3_OPENAI_EMBEDDING_DIM ?? 3072);
}

/** Same four real provisioners `ProvisionTenant`/`DeprovisionTenant` already depend on, mirroring `scripts/seed-iam-demo-data.ts`'s own `buildProvisioners()`. */
export function storeProvisioners(): readonly StoreProvisioner[] {
  return [
    new SqlStoreProvisioner(),
    new RedisStoreProvisioner(),
    new AiGraphProvisioner(),
    new AiVectorProvisioner({
      embeddingModel: defaultEmbeddingModel(),
      embeddingDimensions: defaultEmbeddingDimensions(),
    }),
  ];
}

/** The compound platform-operator gate, real `TenantProfileReader` adapter. */
export function platformOperatorGate(): RequirePlatformOperator {
  return new RequirePlatformOperator({ tenantProfile: new PrismaTenantProfileReader() });
}

/** `TenantSessionRevoker` — the seam `SuspendTenant` uses to end every live session for the target tenant. */
export function sessionRevoker(): SessionStoreTenantRevoker {
  return new SessionStoreTenantRevoker(new RedisSessionStore());
}
