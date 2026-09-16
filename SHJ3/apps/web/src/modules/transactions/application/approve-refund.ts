/**
 * **Approve refund** — `POST /payments/transactions/{reference}/refund/
 * approve` (api.md §6.11), `users.manage`, idempotent, audited.
 *
 * api.md §6.11's own prose describes a `refund_pending_gateway` intermediate
 * state for "an approval whose gateway call fails" — **that state has no
 * column value in the real schema** (`CK_RefundRequests_status` is exactly
 * `Pending`|`Approved`|`Declined`; `CK_Transactions_status` has no such value
 * either), confirmed by grepping the real constraint rather than assuming the
 * doc's prose names a real enum member. Flagged rather than silently
 * invented: this use case's real behaviour is honest instead — a failed
 * gateway call leaves both rows exactly as they were (`RefundRequests.status`
 * stays `Pending`, `Transactions.status` stays `RefundRequested`) and returns
 * a real failure the caller can retry, rather than writing a status value
 * that would violate the live CHECK constraint. A `refund_pending_gateway`
 * tri-state would need its own migration and is named here as separable
 * future work, not routed around.
 */

import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type { Money } from "../domain/money.js";
import type { PaymentGateway } from "../ports/payment-gateway.js";
import type { PaymentEventRepository } from "../ports/payment-event-repository.js";
import type {
  DecideRefundRequestResult,
  RefundRequestRepository,
} from "../ports/refund-request-repository.js";
import type { TransactionRepository } from "../ports/transaction-repository.js";

export type ApproveRefundResult =
  | DecideRefundRequestResult
  | { readonly ok: false; readonly reason: "payments.gateway_refund_failed" };

export interface ApproveRefundDeps {
  readonly gateway: PaymentGateway;
  readonly refunds: RefundRequestRepository;
  readonly transactions: TransactionRepository;
  readonly events: PaymentEventRepository;
  readonly audit: AuditSink;
}

export class ApproveRefund {
  constructor(private readonly deps: ApproveRefundDeps) {}

  async execute(input: {
    readonly refundRequestId: string;
    readonly actor: Principal;
    readonly now: Date;
  }): Promise<ApproveRefundResult> {
    const { gateway, refunds, transactions, events, audit } = this.deps;

    const refund = await refunds.findById(input.refundRequestId);
    if (!refund) return { ok: false, reason: "payments.refund_not_requested" };
    if (refund.status !== "Pending")
      return { ok: false, reason: "payments.refund_already_resolved" };

    const transaction = await transactions.findById(refund.transactionId);
    if (!transaction) return { ok: false, reason: "payments.refund_not_requested" };

    const amount: Money = {
      amountMinor: refund.amountMinor,
      currency: transaction.amount.currency,
    };
    const gatewayResult = await gateway.refund(
      { gatewayReference: transaction.gatewayReference ?? transaction.reference },
      amount,
      { value: `refund_${refund.id}` },
    );

    if (gatewayResult.outcome.kind === "declined") {
      return { ok: false, reason: "payments.gateway_refund_failed" };
    }

    const decided = await refunds.decide({
      id: refund.id,
      outcome: "Approved",
      decidedByStaffUserId: input.actor.id,
      decisionNote: null,
      now: input.now,
    });
    if (!decided.ok) return decided;

    await transactions.resolveRefund(transaction.id, "Refunded", input.now);
    await events.record({
      transactionId: transaction.id,
      kind: "refund_settled",
      gatewayEventId: gatewayResult.outcome.gatewayRefundReference,
      payloadRedactedJson: JSON.stringify({ refundRequestId: refund.id }),
      signatureVerified: true,
      occurredAt: input.now,
      now: input.now,
    });

    await audit.record({
      actor: { kind: "Principal", principal: input.actor },
      action: "payments.refund_approved",
      target: { kind: "RefundRequest", id: refund.id, labelSnapshot: transaction.reference },
      summary: `Approved refund of ${refund.amountMinor} ${transaction.amount.currency} on ${transaction.reference}`,
      before: { status: "Pending" },
      after: { status: "Approved" },
    });

    return decided;
  }
}
