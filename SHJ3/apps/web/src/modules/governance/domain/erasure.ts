/**
 * `ErasureRequests`/`ErasureTasks` — B14 tab 4, §10.4. Pure domain logic: the
 * four-store completeness rule the real `TR_ErasureRequests_completionRequiresAllStores`
 * trigger enforces at the DB level (this file is the proactive mirror, same relationship
 * `domain/promotion.ts` has to `TR_PromotionRequests_decisionRules`).
 *
 * "A store that was not checked is indistinguishable from a store that was found clean"
 * (the real schema's own doc comment, quoted verbatim) is why `ERASURE_STORES` has
 * exactly four members and completeness means **all four**, each genuinely verified —
 * never "no error was thrown."
 */

import { ERASURE_STORES, type ErasureStore } from "./promotion.js";
export { ERASURE_STORES, type ErasureStore };

export const ERASURE_REQUEST_STATUSES = [
  "Received",
  "InProgress",
  "Completed",
  "Rejected",
] as const;
export type ErasureRequestStatus = (typeof ERASURE_REQUEST_STATUSES)[number];

/** `ErasureTasks.state` — no `CK_ErasureTasks_state` enum text was read directly (out of
 *  this file's grep scope), so this mirrors the request-level vocabulary plus the two
 *  states a single store's own task lifecycle needs; `Completed` requires `verifiedAt`
 *  set (`CK_ErasureTasks_completedIsVerified`), enforced in `assertTaskCompletable`
 *  below before ever attempting the write. */
export const ERASURE_TASK_STATES = ["Pending", "InProgress", "Completed", "Failed"] as const;
export type ErasureTaskState = (typeof ERASURE_TASK_STATES)[number];

export interface ErasureTaskOutcome {
  readonly store: ErasureStore;
  readonly state: ErasureTaskState;
  readonly verifiedAt: Date | null;
}

/** `CK_ErasureTasks_completedIsVerified`'s application-layer mirror — never mark a task
 *  `Completed` without a real verification timestamp, whether or not the store found
 *  anything to remove (`affectedCount` may legitimately be `0`). */
export function assertTaskCompletable(state: ErasureTaskState, verifiedAt: Date | null): void {
  if (state === "Completed" && verifiedAt === null) {
    throw new Error(
      "An erasure task cannot be marked Completed without a verifiedAt timestamp " +
        "(CK_ErasureTasks_completedIsVerified) — verify zero rows/nodes/points/keys remain " +
        "and stamp verifiedAt even when affectedCount is 0.",
    );
  }
}

/** `TR_ErasureRequests_completionRequiresAllStores`'s application-layer mirror: all four
 *  stores present, each genuinely `Completed` with `verifiedAt` set. Returns `false`
 *  (never throws) — the caller (`ProcessErasureRequest`) decides what an incomplete set
 *  means (leave `InProgress`, visible and alertable, per the real schema's own doc
 *  comment), matching this codebase's "zero rows means false, not an exception" habit for
 *  conditional-completion checks. */
export function allStoresVerifiedComplete(
  tasks: readonly ErasureTaskOutcome[],
  stores: readonly ErasureStore[] = ["SqlServer", "Neo4j", "Qdrant", "Redis"],
): boolean {
  return stores.every((store) =>
    tasks.some(
      (task) => task.store === store && task.state === "Completed" && task.verifiedAt !== null,
    ),
  );
}

export class ErasureRequestNotFoundError extends Error {
  readonly code = "governance.erasure_request_not_found";
  constructor() {
    super("This erasure request does not exist.");
    this.name = "ErasureRequestNotFoundError";
  }
}

/** api.md: `409 governance.erasure_conflicts_with_retention` — a request whose scope is
 *  transaction records alone can never complete (FR-GOV-24's statutory carve-out). */
export class ErasureConflictsWithRetentionError extends Error {
  readonly code = "governance.erasure_conflicts_with_retention";
  constructor() {
    super(
      "Transaction records are retained for the statutory 7-year period regardless of an " +
        "erasure request (FR-GOV-24) — this scope can never be honoured.",
    );
    this.name = "ErasureConflictsWithRetentionError";
  }
}
