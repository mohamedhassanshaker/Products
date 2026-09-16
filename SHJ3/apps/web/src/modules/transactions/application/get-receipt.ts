/**
 * `GET /api/public/v1/conversations/{id}/receipt/{txnRef}` and the backoffice
 * `GET /payments/transactions/{reference}/receipt` (api.md §4.2, §6.11) share
 * this use case — a receipt is only ever rendered from a `Settled` (or later)
 * transaction, never from one still `Initiated`/`Pending`.
 */

import type { TransactionRepository, TransactionRow } from "../ports/transaction-repository.js";

export type GetReceiptResult =
  | { readonly ok: true; readonly transaction: TransactionRow }
  | { readonly ok: false; readonly reason: "payments.transaction_not_found" }
  | { readonly ok: false; readonly reason: "payments.receipt_not_yet_available" };

export interface GetReceiptDeps {
  readonly transactions: TransactionRepository;
}

export class GetReceipt {
  constructor(private readonly deps: GetReceiptDeps) {}

  async execute(reference: string): Promise<GetReceiptResult> {
    const transaction = await this.deps.transactions.findByReference(reference);
    if (!transaction) return { ok: false, reason: "payments.transaction_not_found" };

    const receiptable = ["Settled", "RefundRequested", "Refunded"].includes(transaction.status);
    if (!receiptable) return { ok: false, reason: "payments.receipt_not_yet_available" };

    return { ok: true, transaction };
  }
}
