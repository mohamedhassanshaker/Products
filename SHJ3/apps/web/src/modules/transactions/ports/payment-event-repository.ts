/**
 * `PaymentEvents` — the gateway webhook ledger. Append-only, and idempotent by
 * construction: `UQ_PaymentEvents_gatewayEventId` means a redelivered webhook
 * is discarded by the unique index, not by a code path this port would need to
 * get right on its own.
 */

export interface PaymentEventRow {
  readonly id: string;
  readonly transactionId: string;
  readonly kind: string;
  readonly gatewayEventId: string;
  readonly payloadRedactedJson: string;
  readonly signatureVerified: boolean;
  readonly occurredAt: Date;
  readonly receivedAt: Date;
}

export type RecordPaymentEventResult =
  | { readonly ok: true; readonly event: PaymentEventRow }
  | { readonly ok: false; readonly reason: "payments.event_already_recorded" };

export interface PaymentEventRepository {
  record(input: {
    readonly transactionId: string;
    readonly kind: string;
    readonly gatewayEventId: string;
    readonly payloadRedactedJson: string;
    /** `CK_PaymentEvents_signatureVerified` — an unverified webhook is rejected at the adapter and never becomes a row; this parameter exists so that rejection happens before the repository call, not after. */
    readonly signatureVerified: true;
    readonly occurredAt: Date;
    readonly now: Date;
  }): Promise<RecordPaymentEventResult>;

  listForTransaction(transactionId: string): Promise<readonly PaymentEventRow[]>;
}
