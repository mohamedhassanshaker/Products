import {
  getPlatformDb,
  getTenantDb,
} from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { versionLabel } from "../../../domain/promotion.js";
import type {
  EnvironmentRepository,
  EnvironmentRow,
} from "../../../ports/environment-repository.js";

const OPERATION = "governance environments";

/**
 * `platform.Environments` joined, in application code, with `VersionDeployments`
 * (tenant schema) grouped by `environmentKey` — two separate Prisma clients (ADR-0011:
 * no `@relation` crosses the platform/tenant boundary), so this is deliberately two
 * queries plus an in-memory join, never raw SQL.
 */
export class PrismaEnvironmentRepository implements EnvironmentRepository {
  async list(): Promise<readonly EnvironmentRow[]> {
    const [environments, deployed] = await Promise.all([
      getPlatformDb(OPERATION).environment.findMany({ orderBy: { ordinal: "asc" } }),
      getTenantDb(OPERATION).versionDeployment.findMany({
        where: { state: "Deployed" },
        include: {
          agent: { select: { id: true } },
          agentVersion: { select: { major: true, minor: true } },
        },
      }),
    ]);

    return environments.map((environment) => {
      const deployments = deployed.filter((row) => row.environmentKey === environment.key);
      const distinctAgentIds = new Set(deployments.map((row) => row.agentId));
      return {
        key: environment.key,
        displayName: environment.displayName,
        ordinal: environment.ordinal,
        promotesToKey: environment.promotesToKey,
        isLive: environment.isLive,
        agentCount: distinctAgentIds.size,
        deployedVersionLabels: deployments.map((row) =>
          versionLabel(row.agentVersion.major, row.agentVersion.minor),
        ),
      };
    });
  }

  async findByKey(key: string): Promise<EnvironmentRow | null> {
    const all = await this.list();
    return all.find((row) => row.key === key) ?? null;
  }
}
