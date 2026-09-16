import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import { retentionCutoff } from "../domain/privacy.js";
import type { PrivacyConfigRepository } from "../ports/privacy-config-repository.js";
import type { CitizenCacheEraser } from "../ports/citizen-cache-eraser.js";
import type {
  RetentionSweepDataRepository,
  RetentionSweepRunRepository,
  RetentionSweepRunRow,
} from "../ports/retention-sweep-repository.js";

const BATCH_LIMIT = 500;

/**
 * B14 tab 4's scheduled purge job (FR-GOV-23/24/27), invocable on demand from the
 * backoffice until a real scheduler triggers it (deployment's job, not this wave's).
 *
 * ## What is real here, and what is a named, deliberate gap
 *
 * `conversationsPurged`/`turnsPurged`/`tracesPurged`/`redisKeysPurged` are REAL counts
 * from real deletes against a real tenant database and a real Redis instance.
 * `transactionsSkipped` is a REAL count of transactions the sweep deliberately left
 * untouched (FR-GOV-24's statutory carve-out — never silently omitted).
 * `derivedMemoryPurged`/`vectorsPurged`/`graphNodesPurged` are always `0`: no distinct
 * "derived memory" persistence model exists in the current schema beyond the transcripts
 * this sweep already purges (RISK-022's resolution folded "derived memory" into
 * transcript retention conceptually, without a separate table — confirmed by grep, not
 * assumed), and Neo4j/Qdrant hold knowledge-base content only, never conversation data
 * (the identical structural fact `GraphVectorErasureVerifier` documents for erasure) —
 * so there is nothing time-bound to purge in either store for this sweep to find. Both
 * facts are named plainly here and in this module's final report, not silently zeroed.
 *
 * `cutoffAt` recorded on the run is INFORMATIONAL — today's configured retention window
 * applied to `now` — while the actual purge predicate uses each conversation's own,
 * already-stamped `retentionExpiresAt` (see `ports/retention-sweep-repository.ts`'s module
 * comment for why: a row must never have its lifetime shortened retroactively by a later,
 * stricter setting).
 */
export class RunRetentionSweep {
  constructor(
    private readonly deps: {
      readonly privacyConfig: PrivacyConfigRepository;
      readonly data: RetentionSweepDataRepository;
      readonly cache: CitizenCacheEraser;
      readonly runs: RetentionSweepRunRepository;
      readonly audit: AuditSink;
    },
  ) {}

  async execute(input: {
    readonly actor: Principal;
    readonly now: Date;
  }): Promise<RetentionSweepRunRow> {
    const config = await this.deps.privacyConfig.get();
    const retentionSetting = config?.transcriptRetention ?? "Days90";
    const cutoffAt = retentionCutoff(retentionSetting, input.now);

    const run = await this.deps.runs.start({
      scope: "Conversations",
      retentionSetting,
      cutoffAt,
      now: input.now,
    });

    let conversationsPurged = 0;
    let turnsPurged = 0;
    let tracesPurged = 0;
    let transactionsSkipped = 0;
    let redisKeysPurged = 0;

    const candidates = await this.deps.data.findConversationsPastRetention(input.now, BATCH_LIMIT);
    for (const candidate of candidates) {
      // Traces (and their steps) before turns — see `PrismaRetentionSweepDataRepository
      // .deleteTraces`'s own doc comment for why the order is deliberate rather than
      // relying on an unverified cascade assumption.
      tracesPurged += await this.deps.data.deleteTraces(candidate.id);
      turnsPurged += await this.deps.data.deleteTurns(candidate.id);
      transactionsSkipped += await this.deps.data.nullTransactionLinks(candidate.id);

      if (candidate.redisSessionKey) {
        const cacheResult = await this.deps.cache.eraseConversationKeys([candidate.id]);
        redisKeysPurged += cacheResult.affectedCount;
      }

      await this.deps.data.markConversationErased(candidate.id, input.now);
      conversationsPurged += 1;
    }

    const finished = await this.deps.runs.finish(run.id, {
      conversationsPurged,
      turnsPurged,
      tracesPurged,
      derivedMemoryPurged: 0,
      vectorsPurged: 0,
      graphNodesPurged: 0,
      redisKeysPurged,
      transactionsSkipped,
      state: "Completed",
      finishedAt: input.now,
    });

    await this.deps.audit.record({
      actor: { kind: "Principal", principal: input.actor },
      action: "governance.retention_sweep_run",
      target: { kind: "RetentionSweepRun", id: finished.id, labelSnapshot: "Retention sweep" },
      summary:
        `Purged ${conversationsPurged} conversation(s), ${turnsPurged} turn(s), ${tracesPurged} trace(s); ` +
        `${transactionsSkipped} transaction(s) retained per FR-GOV-24`,
      after: finished,
    });

    return finished;
  }
}
