/** The real `ReconciliationRepository` — `ReconciliationRuns`, per-tenant. */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isReconciliationRunState,
  isReconciliationScope,
  isReconciliationStore,
} from "../../../domain/knowledge-catalog.js";
import type {
  CompleteReconciliationRunInput,
  NewReconciliationRunInput,
  ReconciliationRepository,
  ReconciliationRunRow,
} from "../../../ports/reconciliation-repository.js";

const OPERATION = "knowledge reconciliation repository";

function toRunRow(row: {
  id: string;
  store: string;
  scope: string;
  knowledgeSourceId: string | null;
  expectedCount: number;
  observedCount: number;
  driftFound: number;
  driftRepaired: number;
  state: string;
  startedAt: Date;
  finishedAt: Date | null;
}): ReconciliationRunRow {
  if (
    !isReconciliationStore(row.store) ||
    !isReconciliationScope(row.scope) ||
    !isReconciliationRunState(row.state)
  ) {
    throw new Error(`ReconciliationRun ${row.id} has an unrecognized store/scope/state.`);
  }
  return {
    id: row.id,
    store: row.store,
    scope: row.scope,
    knowledgeSourceId: row.knowledgeSourceId,
    expectedCount: row.expectedCount,
    observedCount: row.observedCount,
    driftFound: row.driftFound,
    driftRepaired: row.driftRepaired,
    state: row.state,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
  };
}

export class PrismaReconciliationRepository implements ReconciliationRepository {
  async start(input: NewReconciliationRunInput): Promise<{ readonly id: string }> {
    const db = getTenantDb(OPERATION);
    const created = await db.reconciliationRun.create({
      data: {
        id: newUlid(input.startedAt),
        store: input.store,
        scope: input.scope,
        knowledgeSourceId: input.knowledgeSourceId,
        expectedCount: 0,
        observedCount: 0,
        driftFound: 0,
        driftRepaired: 0,
        deadOutboxRequeued: 0,
        reindexJobId: null,
        state: "Running",
        startedAt: input.startedAt,
        finishedAt: null,
        createdAt: input.startedAt,
        updatedAt: input.startedAt,
      },
    });
    return { id: created.id };
  }

  async complete(input: CompleteReconciliationRunInput): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.reconciliationRun.update({
      where: { id: input.id },
      data: {
        expectedCount: input.expectedCount,
        observedCount: input.observedCount,
        driftFound: input.driftFound,
        driftRepaired: input.driftRepaired,
        deadOutboxRequeued: input.deadOutboxRequeued,
        reindexJobId: input.reindexJobId,
        state: input.state,
        finishedAt: input.finishedAt,
        updatedAt: input.finishedAt,
      },
    });
  }

  async list(): Promise<readonly ReconciliationRunRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.reconciliationRun.findMany({ orderBy: { startedAt: "desc" } });
    return rows.map(toRunRow);
  }
}
