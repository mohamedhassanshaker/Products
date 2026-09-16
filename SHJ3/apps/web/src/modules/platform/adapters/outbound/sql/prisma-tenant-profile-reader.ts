import { getTenantDb } from "./tenant-db.js";
import type { TenantProfileReader } from "../../../ports/tenant-profile-reader.js";

const OPERATION = "read tenant profile";

/**
 * `TenantProfileReader` backed by the ambient tenant's own `TenantProfiles`
 * row — ordinary `getTenantDb()` data, no `platformScope` gate needed, the
 * identical technique `prisma-knowledge-source-repository.ts`'s
 * `ensureDefaultCollection` already uses via `db.tenantProfile.findUniqueOrThrow`.
 */
export class PrismaTenantProfileReader implements TenantProfileReader {
  async isPlatformTenant(): Promise<boolean> {
    const db = getTenantDb(OPERATION);
    const profile = await db.tenantProfile.findUniqueOrThrow({ where: { singletonKey: 1 } });
    return profile.isPlatformTenant;
  }
}
