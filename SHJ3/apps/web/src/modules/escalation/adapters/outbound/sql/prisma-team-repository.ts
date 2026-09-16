import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import type { TeamOption, TeamRepository } from "../../../ports/team-repository.js";

export class PrismaTeamRepository implements TeamRepository {
  async list(): Promise<readonly TeamOption[]> {
    const rows = await getTenantDb("routing target teams").team.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    return rows;
  }

  async findById(id: string): Promise<TeamOption | null> {
    const row = await getTenantDb("team lookup").team.findUnique({
      where: { id },
      select: { id: true, name: true },
    });
    return row;
  }
}
