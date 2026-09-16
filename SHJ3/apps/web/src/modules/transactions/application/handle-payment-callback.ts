/**
 * Handle an inbound gateway webhook — api.md §10.2. Idempotent by
 * construction: `PaymentEventRepository.record()`'s own
 * `UQ_PaymentEvents_gatewayEventId` means a redelivered webhook is discarded
 * before any transaction state changes a second time, matching "a redelivered
 * webhook is discarded by the index, not by a code path."
 *
 * `parseCallback` verifies the signature and throws on failure — an
 * unverified webhook never reaches this use case at all, matching
 * `CK_PaymentEvents_signatureVerified`'s own contract that a `PaymentEvents`
 * row can only ever represent a verified one.
 */

import type { PaymentGateway } from "../ports/payment-gateway.js";
import type { PaymentEventRepository } from "../ports/payment-event-repository.js";
import type { TransactionRepository, TransactionRow } from "../ports/transaction-repository.js";

export type HandlePaymentCallbackResult =
  | { readonly ok: true; readonly duplicate: true }
  | { readonly ok: true; readonly duplicate: false; readonly transaction: TransactionRow }
  | { readonly ok: false; readonly reason: "payments.transaction_not_found" };

export interface HandlePaymentCallbackDeps {
  readonly gateway: PaymentGateway;
  readonly transactions: TransactionRepository;
  readonly events: PaymentEventRepository;
}

export class HandlePaymentCallback {
  constructor(private readonly deps: HandlePaymentCallbackDeps) {}

  async execute(input: {
    readonly rawBody: Uint8Array;
    readonly headers: ReadonlyMap<string, string>;
    readonly now: Date;
  }): Promise<HandlePaymentCallbackResult> {
    const { gateway, transactions, events } = this.deps;
    const event = await gateway.parseCallback(input.rawBody, input.headers);

    const transaction = await transactions.findByReference(event.gatewayReference);
    if (!transaction) return { ok: false, reason: "payments.transaction_not_found" };

    const recorded = await events.record({
      transactionId: transaction.id,
      kind: event.kind,
      gatewayEventId: event.gatewayEventId,
      payloadRedactedJson: event.payloadRedactedJson,
      signatureVerified: true,
      occurredAt: event.occurredAt,
      now: input.now,
    });
    if (!recorded.ok) return { ok: true, duplicate: true };

    let updated = transaction;
    if (event.kind === "payment_settled" && transaction.status !== "Settled") {
      updated = await transactions.settle(transaction.id, event.gatewayReference, input.now);
    } else if (event.kind === "payment_failed" && transaction.status === "Initiated") {
      updated = await transactions.fail(transaction.id, "gateway_callback_failed", input.now);
    } else if (event.kind === "refund_settled" && transaction.status === "RefundRequested") {
      updated = await transactions.resolveRefund(transaction.id, "Refunded", input.now);
    }

    return { ok: true, duplicate: false, transaction: updated };
  }
}
