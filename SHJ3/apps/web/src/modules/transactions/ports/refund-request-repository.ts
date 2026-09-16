/**
 * `RefundRequests` — B11 tab 4's pending item and its resolution.
 * `UQ_RefundRequests_pendingPerTransaction` means only one `Pending` row may
 * exist per transaction at a time; `TR_RefundRequests_amountWithinTransaction`
 * caps the refundable amount at the settled amount less prior refunds.
 */

import type { RefundRequestedByKind, RefundStatus } from "../domain/refund-status.js";

export interface RefundRequestRow {
  readonly id: string;
  readonly transactionId: string;
  readonly requestedByKind: RefundRequestedByKind;
  readonly requestedByStaffUserId: string | null;
  readonly reason: string;
  readonly amountMinor: bigint;
  readonly status: RefundStatus;
  readonly decidedByStaffUserId: string | null;
  readonly decidedAt: Date | null;
  readonly decisionNote: string | null;
  readonly requestedAt: Date;
}

export type CreateRefundRequestResult =
  | { readonly ok: true; readonly refund: RefundRequestRow }
  | {
      readonly ok: false;
      readonly reason: "payments.refund_already_pending" | "payments.amount_mismatch";
    };

export type DecideRefundRequestResult =
  | { readonly ok: true; readonly refund: RefundRequestRow }
  | {
      readonly ok: false;
      readonly reason:
        | "payments.refund_not_requested"
        | "payments.refund_already_resolved"
        | "payments.amount_mismatch";
    };

export interface RefundRequestRepository {
  findPendingForTransaction(transactionId: string): Promise<RefundRequestRow | null>;
  findById(id: string): Promise<RefundRequestRow | null>;

  /** B11 tab 4's own pending-items list — every `Pending` row across the tenant. */
  listPending(): Promise<readonly RefundRequestRow[]>;

  create(input: {
    readonly transactionId: string;
    readonly requestedByKind: RefundRequestedByKind;
    readonly requestedByStaffUserId: string | null;
    readonly reason: string;
    readonly amountMinor: bigint;
    readonly now: Date;
  }): Promise<CreateRefundRequestResult>;

  decide(input: {
    readonly id: string;
    readonly outcome: "Approved" | "Declined";
    readonly decidedByStaffUserId: string;
    readonly decisionNote: string | null;
    readonly now: Date;
  }): Promise<DecideRefundRequestResult>;
}
