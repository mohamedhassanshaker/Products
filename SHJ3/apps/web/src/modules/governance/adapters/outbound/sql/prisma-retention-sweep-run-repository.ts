import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  FinishRetentionSweepRunInput,
  RetentionSweepRunRepository,
  RetentionSweepRunRow,
  StartRetentionSweepRunInput,
} from "../../../ports/retention-sweep-repository.js";

const OPERATION = "governance retention sweep run";

export class PrismaRetentionSweepRunRepository implements RetentionSweepRunRepository {
  async start(input: StartRetentionSweepRunInput): Promise<RetentionSweepRunRow> {
    const row = await getTenantDb(OPERATION).retentionSweepRun.create({
      data: {
        id: newUlid(),
        scope: input.scope,
        retentionSetting: input.retentionSetting,
        cutoffAt: input.cutoffAt,
        conversationsPurged: 0,
        turnsPurged: 0,
        tracesPurged: 0,
        derivedMemoryPurged: 0,
        vectorsPurged: 0,
        graphNodesPurged: 0,
        redisKeysPurged: 0,
        transactionsSkipped: 0,
        state: "Running",
        startedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return row;
  }

  async finish(id: string, input: FinishRetentionSweepRunInput): Promise<RetentionSweepRunRow> {
    const row = await getTenantDb(OPERATION).retentionSweepRun.update({
      where: { id },
      data: {
        conversationsPurged: input.conversationsPurged,
        turnsPurged: input.turnsPurged,
        tracesPurged: input.tracesPurged,
        derivedMemoryPurged: input.derivedMemoryPurged,
        vectorsPurged: input.vectorsPurged,
        graphNodesPurged: input.graphNodesPurged,
        redisKeysPurged: input.redisKeysPurged,
        transactionsSkipped: input.transactionsSkipped,
        state: input.state,
        finishedAt: input.finishedAt,
        updatedAt: input.finishedAt,
      },
    });
    return row;
  }

  async list(limit: number): Promise<readonly RetentionSweepRunRow[]> {
    return getTenantDb(OPERATION).retentionSweepRun.findMany({
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }
}
