/**
 * Raise a refund request — the citizen-initiated path (`POST .../refund-
 * requests`, `verified_otp`, gated on `ReceiptConfigs.
 * allowRefundRequestsFromAssistant`) and the back-office path (B11 tab 4)
 * share this one use case.
 */

import type { RefundRequestedByKind } from "../domain/refund-status.js";
import type {
  RefundRequestRepository,
  RefundRequestRow,
} from "../ports/refund-request-repository.js";
import type { TransactionRepository } from "../ports/transaction-repository.js";

export type RequestRefundResult =
  | { readonly ok: true; readonly refund: RefundRequestRow }
  | { readonly ok: false; readonly reason: "payments.transaction_not_found" }
  | { readonly ok: false; readonly reason: "payments.transaction_not_settled" }
  | { readonly ok: false; readonly reason: "payments.refund_already_pending" }
  | { readonly ok: false; readonly reason: "payments.amount_mismatch" };

export interface RequestRefundDeps {
  readonly transactions: TransactionRepository;
  readonly refunds: RefundRequestRepository;
}

export class RequestRefund {
  constructor(private readonly deps: RequestRefundDeps) {}

  async execute(input: {
    readonly transactionReference: string;
    readonly requestedByKind: RefundRequestedByKind;
    readonly requestedByStaffUserId: string | null;
    readonly reason: string;
    readonly amountMinor: bigint;
    readonly now: Date;
  }): Promise<RequestRefundResult> {
    const transaction = await this.deps.transactions.findByReference(input.transactionReference);
    if (!transaction) return { ok: false, reason: "payments.transaction_not_found" };
    if (transaction.status !== "Settled") {
      // `RefundRequested` specifically means this transaction's own status
      // transition already recorded a pending request — more informative to
      // a caller than the generic "not settled" every other non-`Settled`
      // status (never charged, already refunded, ...) actually means.
      return {
        ok: false,
        reason:
          transaction.status === "RefundRequested"
            ? "payments.refund_already_pending"
            : "payments.transaction_not_settled",
      };
    }

    const created = await this.deps.refunds.create({
      transactionId: transaction.id,
      requestedByKind: input.requestedByKind,
      requestedByStaffUserId: input.requestedByStaffUserId,
      reason: input.reason,
      amountMinor: input.amountMinor,
      now: input.now,
    });
    if (!created.ok) return created;

    await this.deps.transactions.markRefundRequested(transaction.id, input.now);
    return { ok: true, refund: created.refund };
  }
}
