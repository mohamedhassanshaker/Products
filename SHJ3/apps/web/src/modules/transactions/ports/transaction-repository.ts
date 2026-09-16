/**
 * `Transactions` — the money record. **Statutory 7-year retention, exempt
 * from transcript retention** (`docs/data-model.md` §4.12). This port
 * deliberately has no delete method: `TR_Transactions_blockDelete` rejects any
 * delete inside the 7-year window regardless of caller, and there is no
 * legitimate caller outside that window either (a purged conversation nulls
 * `conversationId`, per the retention sweep design, but the transaction row
 * itself persists) — so the port's own shape is the first line of the
 * carve-out, matching `OrchestrationStore`'s established pattern of simply not
 * offering a method the grant/rule would reject anyway.
 */

import type { Money } from "../domain/money.js";
import type { TransactionStatus } from "../domain/transaction-status.js";

export interface TransactionRow {
  readonly id: string;
  readonly reference: string;
  readonly conversationId: string | null;
  readonly citizenIdentityId: string;
  readonly paymentGatewayId: string;
  readonly serviceKey: string;
  readonly serviceLabel: string;
  readonly linkedServiceAccountId: string | null;
  readonly amount: Money;
  readonly status: TransactionStatus;
  readonly gatewayReference: string | null;
  readonly idempotencyKey: string;
  /** Never `Anonymous` — `CK_Transactions_verifiedOnly`'s own contract, enforced structurally (see `create()`). */
  readonly assuranceLevelAtPayment: string;
  readonly initiatedAt: Date;
  readonly settledAt: Date | null;
  readonly failureCode: string | null;
  /** `DATEADD(YEAR, 7, initiatedAt)`, computed and persisted by SQL Server — read-only, never written by this port. */
  readonly retentionExpiresAt: Date;
}

export type CreateTransactionResult =
  | { readonly ok: true; readonly transaction: TransactionRow }
  | { readonly ok: false; readonly reason: "payments.assurance_insufficient" };

export interface TransactionFilter {
  readonly status?: TransactionStatus;
  readonly serviceKey?: string;
  readonly reference?: string;
  readonly rangeFrom?: Date;
  readonly rangeTo?: Date;
}

export interface TransactionRepository {
  findById(id: string): Promise<TransactionRow | null>;
  findByReference(reference: string): Promise<TransactionRow | null>;

  /** ADR-0003's Redis-idempotency-key pattern, mirrored here at the row level (FR-PAY-07): a retry with the same key returns the same row, never a second charge. */
  findByIdempotencyKey(idempotencyKey: string): Promise<TransactionRow | null>;

  list(filter: TransactionFilter, limit: number): Promise<readonly TransactionRow[]>;

  create(input: {
    readonly reference: string;
    readonly conversationId: string | null;
    readonly citizenIdentityId: string;
    readonly paymentGatewayId: string;
    readonly serviceKey: string;
    readonly serviceLabel: string;
    readonly linkedServiceAccountId: string | null;
    readonly amount: Money;
    readonly idempotencyKey: string;
    /** `Anonymous` is refused here — see `CK_Transactions_verifiedOnly`. */
    readonly assuranceLevelAtPayment: string;
    readonly now: Date;
  }): Promise<CreateTransactionResult>;

  settle(id: string, gatewayReference: string, now: Date): Promise<TransactionRow>;
  fail(id: string, failureCode: string, now: Date): Promise<TransactionRow>;
  decline(id: string, failureCode: string, now: Date): Promise<TransactionRow>;

  /** `Settled` -> `RefundRequested`. */
  markRefundRequested(id: string, now: Date): Promise<TransactionRow>;
  /** `RefundRequested` -> `Refunded` (approve) or back to `Settled` (decline). */
  resolveRefund(id: string, outcome: "Refunded" | "Settled", now: Date): Promise<TransactionRow>;
}
