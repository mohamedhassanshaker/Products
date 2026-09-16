/**
 * Real set comparison and drift repair for one source, per §9.3 — run once per derived
 * store (`Neo4j`, `Qdrant`), each producing its own `ReconciliationRun` row (the schema
 * models `store` as a single value per run, not a pair).
 *
 * **Two honest, locked-contract limitations, named rather than hidden:**
 *  - `POST /knowledge/reconcile/inspect`'s response carries only chunk ids
 *    (`observedVectorChunkIds`/`observedGraphChunkIds`), never a content hash — so this
 *    wave can detect *missing* (expected, not observed) and *orphaned* (observed, not
 *    expected) drift, but not *divergent* (present in both, content changed) drift, which
 *    §9.3 step 3 also names. Detecting that would need the endpoint to return a hash per
 *    observed id, which is not part of the locked contract this wave calls.
 *  - The locked contract has no "delete this one orphaned vector/node by chunk id"
 *    endpoint (only `graph/nodes/delete`, keyed by `canonicalKey`, not `chunk/graph`
 *    deletion by chunk id). Orphans are therefore counted in `driftFound` and reported,
 *    but not individually deleted — the repair path this wave *can* execute is escalation
 *    to a scoped `ReindexJob` when drift crosses the documented 5% threshold (§9.3 step
 *    4), which re-embeds/re-writes the source's real chunks and is the same mechanism B6
 *    tab 3's "Re-index all sources now" already uses.
 *
 * The G11/G12 graph-invariant sweep (§9.3 step 6, endpoint 11) is a separate concern,
 * already wired as `CheckGraphInvariants` / the graph tab's health banner — not repeated
 * here.
 */

import type { ChunkRepository } from "../ports/chunk-repository.js";
import type { KnowledgeAiClient } from "../ports/knowledge-ai-client.js";
import type { OutboxRepository } from "../ports/outbox-repository.js";
import type { ReconciliationRepository } from "../ports/reconciliation-repository.js";
import type { NewReindexJobInput, ReindexJobRepository } from "../ports/reindex-job-repository.js";

/** Above this fraction of a source's expected chunks showing drift, individual repair is abandoned in favour of a scoped `ReindexJob` (§9.3 step 4). */
const ESCALATION_THRESHOLD = 0.05;

export interface ReconcileSourceStoreInput {
  readonly knowledgeSourceId: string;
  readonly store: "Neo4j" | "Qdrant";
  readonly now: Date;
}

export interface ReconcileSourceStoreResult {
  readonly runId: string;
  readonly expectedCount: number;
  readonly observedCount: number;
  readonly driftFound: number;
  readonly driftRepaired: number;
  readonly deadOutboxRequeued: number;
  readonly escalatedReindexJobId: string | null;
}

export interface ReconcileKnowledgeDeps {
  readonly reconciliation: ReconciliationRepository;
  readonly chunks: ChunkRepository;
  readonly outbox: OutboxRepository;
  readonly reindexJobs: ReindexJobRepository;
  readonly ai: KnowledgeAiClient;
}

export class ReconcileKnowledge {
  constructor(private readonly deps: ReconcileKnowledgeDeps) {}

  async execute(input: ReconcileSourceStoreInput): Promise<ReconcileSourceStoreResult> {
    const { id: runId } = await this.deps.reconciliation.start({
      store: input.store,
      scope: "Source",
      knowledgeSourceId: input.knowledgeSourceId,
      startedAt: input.now,
    });

    const expected = await this.deps.chunks.listChunksBySource(input.knowledgeSourceId);
    const expectedIds = new Set(expected.map((chunk) => chunk.id));

    const observed = await this.deps.ai.reconcileInspect({
      knowledgeSourceId: input.knowledgeSourceId,
    });
    const observedIds = new Set(
      input.store === "Qdrant" ? observed.observedVectorChunkIds : observed.observedGraphChunkIds,
    );

    const missing = [...expectedIds].filter((id) => !observedIds.has(id));
    const orphaned = [...observedIds].filter((id) => !expectedIds.has(id));
    const driftFound = missing.length + orphaned.length;

    const escalate =
      expectedIds.size > 0 ? driftFound / expectedIds.size > ESCALATION_THRESHOLD : driftFound > 0;

    let driftRepaired = 0;
    let escalatedReindexJobId: string | null = null;

    if (escalate && driftFound > 0) {
      const jobInput: NewReindexJobInput = {
        scope: "Source",
        knowledgeSourceId: input.knowledgeSourceId,
        knowledgeCollectionId: null,
        reason: "Reconciliation",
        targetEmbeddingModel: null,
        ranByStaffUserId: null,
        now: input.now,
      };
      const job = await this.deps.reindexJobs.create(jobInput);
      escalatedReindexJobId = job.id;
    } else if (missing.length > 0) {
      await this.deps.chunks.resetToPending(missing, input.now);
      for (const chunkId of missing) {
        const chunk = expected.find((row) => row.id === chunkId);
        if (!chunk) continue;
        await this.deps.outbox.enqueue({
          aggregateKind: "Chunk",
          aggregateId: chunkId,
          eventType: "ChunkUpserted",
          targetStore: "Both",
          payloadJson: JSON.stringify({
            knowledgeSourceId: chunk.knowledgeSourceId,
            knowledgeCollectionId: chunk.knowledgeCollectionId,
          }),
          // A fresh key per repair attempt: the original `chunk-upsert-<id>` key was very
          // likely already consumed (`Applied`) by the original ingest, so re-using it
          // would be treated as "already queued" and silently do nothing.
          dedupeKey: `chunk-upsert-${chunkId}-reconcile-${input.now.getTime()}`,
          now: input.now,
        });
        driftRepaired += 1;
      }
    }
    // Orphaned drift is reported but not individually repaired here — see this module's
    // own doc comment for why (no per-chunk delete endpoint in the locked contract).

    let deadOutboxRequeued = 0;
    const deadIds: string[] = [];
    for (const chunkId of expectedIds) {
      const dead = await this.deps.outbox.listDeadForAggregate("Chunk", chunkId);
      for (const event of dead) deadIds.push(event.id);
    }
    if (deadIds.length > 0) {
      await this.deps.outbox.requeueDead(deadIds, input.now);
      deadOutboxRequeued = deadIds.length;
    }

    await this.deps.reconciliation.complete({
      id: runId,
      expectedCount: expectedIds.size,
      observedCount: observedIds.size,
      driftFound,
      driftRepaired,
      deadOutboxRequeued,
      reindexJobId: escalatedReindexJobId,
      state: "Completed",
      finishedAt: input.now,
    });

    return {
      runId,
      expectedCount: expectedIds.size,
      observedCount: observedIds.size,
      driftFound,
      driftRepaired,
      deadOutboxRequeued,
      escalatedReindexJobId,
    };
  }
}
