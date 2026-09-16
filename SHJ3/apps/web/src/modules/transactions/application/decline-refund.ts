/**
 * **Decline refund** — `POST /payments/transactions/{reference}/refund/
 * decline` (api.md §6.11), `users.manage`, `{reason}` mandatory, audited.
 * Restores the transaction to `Settled` — no gateway call, since nothing was
 * ever charged back.
 */

import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type {
  DecideRefundRequestResult,
  RefundRequestRepository,
} from "../ports/refund-request-repository.js";
import type { TransactionRepository } from "../ports/transaction-repository.js";

export interface DeclineRefundDeps {
  readonly refunds: RefundRequestRepository;
  readonly transactions: TransactionRepository;
  readonly audit: AuditSink;
}

export class DeclineRefund {
  constructor(private readonly deps: DeclineRefundDeps) {}

  async execute(input: {
    readonly refundRequestId: string;
    readonly reason: string;
    readonly actor: Principal;
    readonly now: Date;
  }): Promise<DecideRefundRequestResult> {
    const { refunds, transactions, audit } = this.deps;

    const refund = await refunds.findById(input.refundRequestId);
    if (!refund) return { ok: false, reason: "payments.refund_not_requested" };
    if (refund.status !== "Pending")
      return { ok: false, reason: "payments.refund_already_resolved" };

    const decided = await refunds.decide({
      id: refund.id,
      outcome: "Declined",
      decidedByStaffUserId: input.actor.id,
      decisionNote: input.reason,
      now: input.now,
    });
    if (!decided.ok) return decided;

    const transaction = await transactions.findById(refund.transactionId);
    if (transaction) {
      await transactions.resolveRefund(transaction.id, "Settled", input.now);
      await audit.record({
        actor: { kind: "Principal", principal: input.actor },
        action: "payments.refund_declined",
        target: { kind: "RefundRequest", id: refund.id, labelSnapshot: transaction.reference },
        summary: `Declined refund on ${transaction.reference}: ${input.reason}`,
        before: { status: "Pending" },
        after: { status: "Declined", reason: input.reason },
      });
    }

    return decided;
  }
}
