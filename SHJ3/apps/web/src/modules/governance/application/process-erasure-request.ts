import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import {
  allStoresVerifiedComplete,
  ErasureRequestNotFoundError,
  type ErasureTaskOutcome,
} from "../domain/erasure.js";
import type { CitizenCacheEraser } from "../ports/citizen-cache-eraser.js";
import type { CitizenDataEraser } from "../ports/citizen-data-eraser.js";
import type {
  ErasureRequestRepository,
  ErasureTaskRow,
} from "../ports/erasure-request-repository.js";
import type { GraphVectorErasureVerifier } from "../ports/graph-vector-erasure-verifier.js";

export class ErasureRequestHasNoLinkedCitizenError extends Error {
  readonly code = "governance.erasure_request_unlinked";
  constructor() {
    super(
      "This erasure request has no linked CitizenIdentity yet — it cannot be processed " +
        "as a citizen-scoped erasure until one is attached.",
    );
    this.name = "ErasureRequestHasNoLinkedCitizenError";
  }
}

/**
 * B14 tab 4's "process an erasure request" flow (FR-GOV-22, §10.4). Runs all four store
 * tasks for real (SQL Server + Redis are genuinely exercised from `apps/web`; Neo4j/Qdrant
 * are recorded via `GraphVectorErasureVerifier`'s structural check — see that port's own
 * module comment for why a LIVE query from this tier is architecturally not possible,
 * ADR-0003), then attempts `status = 'Completed'` — which the real DB trigger
 * (`TR_ErasureRequests_completionRequiresAllStores`) only allows once all four
 * `ErasureTasks` rows are genuinely `Completed` + verified. "A store that was not checked
 * is indistinguishable from a store that was found clean" (the real schema's own doc
 * comment) is why every store is recorded even when it found nothing — `affectedCount: 0`
 * is a real, positive result, never an omission.
 */
export class ProcessErasureRequest {
  constructor(
    private readonly deps: {
      readonly erasureRequests: ErasureRequestRepository;
      readonly sqlEraser: CitizenDataEraser;
      readonly cacheEraser: CitizenCacheEraser;
      readonly graphVectorVerifier: GraphVectorErasureVerifier;
      readonly audit: AuditSink;
    },
  ) {}

  async execute(input: {
    readonly erasureRequestId: string;
    readonly actor: Principal;
    readonly now: Date;
  }): Promise<{
    readonly completed: boolean;
    readonly tasks: readonly ErasureTaskRow[];
  }> {
    const request = await this.deps.erasureRequests.findById(input.erasureRequestId);
    if (!request) throw new ErasureRequestNotFoundError();
    if (!request.citizenIdentityId) throw new ErasureRequestHasNoLinkedCitizenError();

    await this.deps.erasureRequests.markInProgress(input.erasureRequestId, input.now);

    const startedAt = input.now;

    // 1. SQL Server — real, tenant-schema deletes/anonymises (see the eraser's own doc
    // comment for the full table-by-table rationale, including the Transactions carve-out).
    const sqlResult = await this.deps.sqlEraser.erase(request.citizenIdentityId, input.now);
    await this.deps.erasureRequests.recordTaskResult({
      erasureRequestId: input.erasureRequestId,
      store: "SqlServer",
      scopeDescription:
        "Every SQL Server row linked to this citizen, except Transactions (FR-GOV-24)",
      state: "Completed",
      affectedCount: sqlResult.affectedCount,
      verificationQuery: sqlResult.verificationQuery,
      verifiedAt: input.now,
      startedAt,
      finishedAt: input.now,
      error: null,
    });

    // 2. Redis — real, live delete + verify of the citizen's conversation session keys.
    const cacheResult = await this.deps.cacheEraser.eraseConversationKeys(
      sqlResult.purgedConversationIds,
    );
    await this.deps.erasureRequests.recordTaskResult({
      erasureRequestId: input.erasureRequestId,
      store: "Redis",
      scopeDescription: "Every Redis session/slot key for this citizen's conversations",
      state: "Completed",
      affectedCount: cacheResult.affectedCount,
      verificationQuery: cacheResult.verificationQuery,
      verifiedAt: input.now,
      startedAt,
      finishedAt: input.now,
      error: null,
    });

    // 3 & 4. Neo4j / Qdrant — structural verification (see `GraphVectorErasureVerifier`'s
    // module comment for why this is not a live per-request query from `apps/web`).
    for (const store of ["Neo4j", "Qdrant"] as const) {
      const result = await this.deps.graphVectorVerifier.verify(store);
      await this.deps.erasureRequests.recordTaskResult({
        erasureRequestId: input.erasureRequestId,
        store,
        scopeDescription: `${store} holds knowledge-base content only, never citizen personal data (ADR-0009)`,
        state: "Completed",
        affectedCount: result.affectedCount,
        verificationQuery: result.verificationQuery,
        verifiedAt: input.now,
        startedAt,
        finishedAt: input.now,
        error: null,
      });
    }

    const tasks = await this.deps.erasureRequests.listTasks(input.erasureRequestId);
    const outcomes: ErasureTaskOutcome[] = tasks.map((task) => ({
      store: task.store,
      state: task.state,
      verifiedAt: task.verifiedAt,
    }));

    let completed = false;
    if (allStoresVerifiedComplete(outcomes)) {
      const evidence = JSON.stringify({
        stores: tasks.map((task) => ({ store: task.store, affectedCount: task.affectedCount })),
        transactionsSkipped: sqlResult.transactionsSkipped,
      });
      await this.deps.erasureRequests.markCompleted(input.erasureRequestId, input.now, evidence);
      completed = true;
    }

    await this.deps.audit.record({
      actor: { kind: "Principal", principal: input.actor },
      action: completed
        ? "governance.erasure_request_completed"
        : "governance.erasure_request_partial",
      target: {
        kind: "ErasureRequest",
        id: input.erasureRequestId,
        labelSnapshot: `Erasure request (${request.subjectKind})`,
      },
      summary: completed
        ? `Completed erasure across all 4 stores (${sqlResult.transactionsSkipped} transaction(s) retained per FR-GOV-24)`
        : `Erasure left InProgress — not all 4 stores verified complete yet`,
      after: {
        tasks: tasks.map((task) => ({
          store: task.store,
          state: task.state,
          affectedCount: task.affectedCount,
        })),
      },
    });

    return { completed, tasks };
  }
}
