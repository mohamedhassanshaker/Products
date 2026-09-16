/**
 * The real `PolicyOverrideDirectoryRepository` — tenant-scoped `PolicyOverrides` via
 * `getTenantDb()`, joined to `Agent` through Prisma's own `agent` relation
 * (`PolicyOverride.agent`, `prisma/tenant/schema.prisma`) rather than a second,
 * hand-written query — the identical, already-established shape
 * `PrismaEnvironmentRepository.list()` uses for `VersionDeployment.agent`/`agentVersion`
 * (`include`, resolved in one round trip, no cross-module import needed since both models
 * live in the same generated tenant Prisma client).
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type {
  PolicyOverrideDirectoryRepository,
  PolicyOverrideDirectoryRow,
} from "../../../ports/policy-override-directory-repository.js";

const OPERATION = "guardrails policy override directory";

export class PrismaPolicyOverrideDirectoryRepository implements PolicyOverrideDirectoryRepository {
  async listActive(): Promise<readonly PolicyOverrideDirectoryRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.policyOverride.findMany({
      where: { removedAt: null },
      include: { agent: { select: { id: true, name: true } } },
      orderBy: [{ policyKey: "asc" }, { createdAt: "desc" }],
    });

    return rows.map((r): PolicyOverrideDirectoryRow => ({
      id: r.id,
      policyKey: r.policyKey,
      agentId: r.agent.id,
      agentName: r.agent.name,
      mode: r.mode,
      valueJson: r.valueJson,
      reason: r.reason,
      createdAt: r.createdAt,
    }));
  }
}
