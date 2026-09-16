import type { ErasureRequestStatus, ErasureStore, ErasureTaskState } from "../domain/erasure.js";

export interface ErasureRequestRow {
  readonly id: string;
  readonly subjectKind: string;
  readonly subjectHash: string;
  readonly citizenIdentityId: string | null;
  readonly receivedVia: string;
  readonly requestedAt: Date;
  readonly status: ErasureRequestStatus;
  readonly rejectionReason: string | null;
  readonly completedAt: Date | null;
  readonly verificationEvidenceJson: string | null;
}

export interface ErasureTaskRow {
  readonly id: string;
  readonly erasureRequestId: string;
  readonly store: ErasureStore;
  readonly scopeDescription: string;
  readonly state: ErasureTaskState;
  readonly affectedCount: number | null;
  readonly verificationQuery: string | null;
  readonly verifiedAt: Date | null;
  readonly error: string | null;
}

export interface NewErasureRequestInput {
  readonly subjectKind: string;
  readonly subjectHash: string;
  readonly citizenIdentityId: string | null;
  readonly receivedVia: string;
  readonly now: Date;
}

export interface RecordTaskResultInput {
  readonly erasureRequestId: string;
  readonly store: ErasureStore;
  readonly scopeDescription: string;
  readonly state: ErasureTaskState;
  readonly affectedCount: number | null;
  readonly verificationQuery: string;
  readonly verifiedAt: Date | null;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly error: string | null;
}

export interface ErasureRequestRepository {
  findById(id: string): Promise<ErasureRequestRow | null>;
  list(): Promise<readonly ErasureRequestRow[]>;
  create(input: NewErasureRequestInput): Promise<ErasureRequestRow>;
  listTasks(erasureRequestId: string): Promise<readonly ErasureTaskRow[]>;

  /** Upserts one `ErasureTasks` row for `(erasureRequestId, store)`
   *  (`UQ_ErasureTasks_erasureRequestId_store`) — a store is recorded exactly once per
   *  request, re-runnable if a prior attempt errored. */
  recordTaskResult(input: RecordTaskResultInput): Promise<ErasureTaskRow>;

  /** `Received -> InProgress` — set once real per-store work begins, so a request that
   *  cannot complete in one pass (see `TR_ErasureRequests_completionRequiresAllStores`'s
   *  own doc comment: "a missed store therefore leaves the request InProgress: visible,
   *  alertable") is visibly mid-flight rather than looking untouched. */
  markInProgress(id: string, now: Date): Promise<void>;

  /** Attempts `status = 'Completed'`. The real DB trigger
   *  (`TR_ErasureRequests_completionRequiresAllStores`) rejects this unless all four
   *  tasks are genuinely `Completed` + verified — this call's own success/failure is that
   *  proof, never re-derived in application code alone. */
  markCompleted(id: string, completedAt: Date, verificationEvidenceJson: string): Promise<void>;
  markRejected(id: string, rejectionReason: string, now: Date): Promise<void>;
}
