import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  ErasureRequestStatus,
  ErasureStore,
  ErasureTaskState,
} from "../../../domain/erasure.js";
import type {
  ErasureRequestRepository,
  ErasureRequestRow,
  ErasureTaskRow,
  NewErasureRequestInput,
  RecordTaskResultInput,
} from "../../../ports/erasure-request-repository.js";

const OPERATION = "governance erasure request";

export class PrismaErasureRequestRepository implements ErasureRequestRepository {
  async findById(id: string): Promise<ErasureRequestRow | null> {
    const row = await getTenantDb(OPERATION).erasureRequest.findUnique({ where: { id } });
    return row ? toRequestRow(row) : null;
  }

  async list(): Promise<readonly ErasureRequestRow[]> {
    const rows = await getTenantDb(OPERATION).erasureRequest.findMany({
      orderBy: { requestedAt: "desc" },
    });
    return rows.map(toRequestRow);
  }

  async create(input: NewErasureRequestInput): Promise<ErasureRequestRow> {
    const row = await getTenantDb(OPERATION).erasureRequest.create({
      data: {
        id: newUlid(),
        subjectKind: input.subjectKind,
        subjectHash: input.subjectHash,
        citizenIdentityId: input.citizenIdentityId,
        receivedVia: input.receivedVia,
        requestedAt: input.now,
        status: "Received",
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toRequestRow(row);
  }

  async listTasks(erasureRequestId: string): Promise<readonly ErasureTaskRow[]> {
    const rows = await getTenantDb(OPERATION).erasureTask.findMany({ where: { erasureRequestId } });
    return rows.map(toTaskRow);
  }

  /** Upserts on `UQ_ErasureTasks_erasureRequestId_store` — re-runnable per store if a
   *  prior attempt errored, without ever producing a fifth row for the same store. */
  async recordTaskResult(input: RecordTaskResultInput): Promise<ErasureTaskRow> {
    const row = await getTenantDb(OPERATION).erasureTask.upsert({
      where: {
        erasureRequestId_store: { erasureRequestId: input.erasureRequestId, store: input.store },
      },
      create: {
        id: newUlid(),
        erasureRequestId: input.erasureRequestId,
        store: input.store,
        scopeDescription: input.scopeDescription,
        state: input.state,
        affectedCount: input.affectedCount,
        verificationQuery: input.verificationQuery,
        verifiedAt: input.verifiedAt,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        error: input.error,
        createdAt: input.startedAt,
        updatedAt: input.finishedAt ?? input.startedAt,
      },
      update: {
        scopeDescription: input.scopeDescription,
        state: input.state,
        affectedCount: input.affectedCount,
        verificationQuery: input.verificationQuery,
        verifiedAt: input.verifiedAt,
        finishedAt: input.finishedAt,
        error: input.error,
        updatedAt: input.finishedAt ?? input.startedAt,
      },
    });
    return toTaskRow(row);
  }

  async markInProgress(id: string, now: Date): Promise<void> {
    await getTenantDb(OPERATION).erasureRequest.update({
      where: { id },
      data: { status: "InProgress", updatedAt: now },
    });
  }

  /** The real DB trigger (`TR_ErasureRequests_completionRequiresAllStores`) rejects this
   *  UPDATE unless all four `ErasureTasks` rows are genuinely `Completed` + verified —
   *  this call's success is that proof, not a separate application-level re-check alone. */
  async markCompleted(
    id: string,
    completedAt: Date,
    verificationEvidenceJson: string,
  ): Promise<void> {
    await getTenantDb(OPERATION).erasureRequest.update({
      where: { id },
      data: { status: "Completed", completedAt, verificationEvidenceJson, updatedAt: completedAt },
    });
  }

  async markRejected(id: string, rejectionReason: string, now: Date): Promise<void> {
    await getTenantDb(OPERATION).erasureRequest.update({
      where: { id },
      data: { status: "Rejected", rejectionReason, updatedAt: now },
    });
  }
}

type ErasureRequestPrismaRow = {
  id: string;
  subjectKind: string;
  subjectHash: string;
  citizenIdentityId: string | null;
  receivedVia: string;
  requestedAt: Date;
  status: string;
  rejectionReason: string | null;
  completedAt: Date | null;
  verificationEvidenceJson: string | null;
};

function toRequestRow(row: ErasureRequestPrismaRow): ErasureRequestRow {
  return { ...row, status: row.status as ErasureRequestStatus };
}

type ErasureTaskPrismaRow = {
  id: string;
  erasureRequestId: string;
  store: string;
  scopeDescription: string;
  state: string;
  affectedCount: number | null;
  verificationQuery: string | null;
  verifiedAt: Date | null;
  error: string | null;
};

function toTaskRow(row: ErasureTaskPrismaRow): ErasureTaskRow {
  return {
    ...row,
    store: row.store as ErasureStore,
    state: row.state as ErasureTaskState,
  };
}
