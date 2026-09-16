import { describe, expect, it } from "vitest";
import { ReconcileKnowledge } from "./reconcile-knowledge.js";
import {
  FakeChunkRepository,
  FakeKnowledgeAiClient,
  FakeOutboxRepository,
  FakeReconciliationRepository,
  FakeReindexJobRepository,
  chunkRowFixture,
} from "../testing/fakes.js";
import type { OutboxEventRow } from "../ports/outbox-repository.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");
const SOURCE_ID = "source_1";

/** Not `Array.from({ length }, (_, i) => ...)`: this project's lint config rejects any unused callback parameter, even underscore-named. */
function chunkIds(count: number, startAt = 0): string[] {
  const ids: string[] = [];
  for (let i = startAt; i < startAt + count; i++) ids.push(`c${i}`);
  return ids;
}

function buildDeps() {
  return {
    reconciliation: new FakeReconciliationRepository(),
    chunks: new FakeChunkRepository(),
    outbox: new FakeOutboxRepository(),
    reindexJobs: new FakeReindexJobRepository(),
    ai: new FakeKnowledgeAiClient(),
  };
}

describe("reconciling one source against one derived store (§9.3)", () => {
  it("repairs small missing drift inline: resets to Pending and enqueues a fresh outbox event", async () => {
    const deps = buildDeps();
    for (let i = 0; i < 20; i++) {
      deps.chunks.seedChunk(
        chunkRowFixture({
          id: `c${i}`,
          knowledgeSourceId: SOURCE_ID,
          vectorState: "Indexed",
          graphState: "Indexed",
        }),
      );
    }
    // Only c0 is missing from the observed vector set — 1/20 = 5%, at the threshold, not
    // above it, so this stays an inline repair rather than escalating.
    deps.ai.setReconcileInspectResult({
      observedVectorChunkIds: chunkIds(19, 1),
      observedGraphChunkIds: chunkIds(20),
    });

    const result = await new ReconcileKnowledge(deps).execute({
      knowledgeSourceId: SOURCE_ID,
      store: "Qdrant",
      now: NOW,
    });

    expect(result.driftFound).toBe(1);
    expect(result.driftRepaired).toBe(1);
    expect(result.escalatedReindexJobId).toBeNull();
    const [repaired] = await deps.chunks.listChunksByIds(["c0"]);
    expect(repaired?.vectorState).toBe("Pending");
  });

  it("escalates to a scoped ReindexJob when drift exceeds the 5% threshold", async () => {
    const deps = buildDeps();
    for (let i = 0; i < 10; i++) {
      deps.chunks.seedChunk(chunkRowFixture({ id: `c${i}`, knowledgeSourceId: SOURCE_ID }));
    }
    // 3 of 10 missing = 30%, well over the threshold.
    deps.ai.setReconcileInspectResult({
      observedVectorChunkIds: chunkIds(7),
      observedGraphChunkIds: chunkIds(10),
    });

    const result = await new ReconcileKnowledge(deps).execute({
      knowledgeSourceId: SOURCE_ID,
      store: "Qdrant",
      now: NOW,
    });

    expect(result.driftFound).toBe(3);
    expect(result.escalatedReindexJobId).toBeTruthy();
    const job = await deps.reindexJobs.get(result.escalatedReindexJobId!);
    expect(job).toMatchObject({
      scope: "Source",
      reason: "Reconciliation",
      knowledgeSourceId: SOURCE_ID,
    });
  });

  it("requeues Dead outbox rows whose chunk still exists in SQL Server", async () => {
    const deps = buildDeps();
    deps.chunks.seedChunk(chunkRowFixture({ id: "c0", knowledgeSourceId: SOURCE_ID }));
    deps.ai.setReconcileInspectResult({
      observedVectorChunkIds: ["c0"],
      observedGraphChunkIds: ["c0"],
    });
    const dead: OutboxEventRow = {
      id: "dead1",
      aggregateKind: "Chunk",
      aggregateId: "c0",
      eventType: "ChunkUpserted",
      targetStore: "Both",
      payloadJson: "{}",
      dedupeKey: "chunk-upsert-c0-old",
      state: "Dead",
      attemptCount: 8,
      maxAttempts: 8,
      availableAt: NOW,
    };
    deps.outbox.seed(dead);

    const result = await new ReconcileKnowledge(deps).execute({
      knowledgeSourceId: SOURCE_ID,
      store: "Qdrant",
      now: NOW,
    });

    expect(result.deadOutboxRequeued).toBe(1);
    expect(deps.outbox.all.find((row) => row.id === "dead1")?.state).toBe("Pending");
  });
});
