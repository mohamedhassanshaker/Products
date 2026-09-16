/**
 * `Transactions.status` — the money record's state machine (`docs/data-model.md`
 * §4.12, FR-PAY-04: "transitions restricted to a documented state machine").
 *
 * Transcribed as a real transition table rather than a free-form status
 * string, so an invalid hop (`Failed` -> `Refunded`, FR-PAY-04's own worked
 * counter-example) is a rejected function call before it ever reaches SQL
 * Server, not just a CHECK constraint the caller discovers by trial.
 */

export const TRANSACTION_STATUSES = [
  "Initiated",
  "Pending",
  "Settled",
  "Failed",
  "Declined",
  "RefundRequested",
  "Refunded",
] as const;

export type TransactionStatus = (typeof TRANSACTION_STATUSES)[number];

export function isTransactionStatus(value: string): value is TransactionStatus {
  return (TRANSACTION_STATUSES as readonly string[]).includes(value);
}

/** The real, documented state machine. Every hop not listed is invalid. */
const TRANSITIONS: Readonly<Record<TransactionStatus, readonly TransactionStatus[]>> = {
  Initiated: ["Pending", "Settled", "Failed", "Declined"],
  Pending: ["Settled", "Failed", "Declined"],
  Settled: ["RefundRequested"],
  Failed: [],
  Declined: [],
  RefundRequested: ["Settled", "Refunded"], // decline -> back to Settled; approve -> Refunded
  Refunded: [],
};

export function canTransitionTransaction(from: TransactionStatus, to: TransactionStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** `CK_Transactions_settledPaired` made visible: only these carry a non-null `settledAt`. */
export function requiresSettledAt(status: TransactionStatus): boolean {
  return status === "Settled" || status === "RefundRequested" || status === "Refunded";
}

/** `CK_Transactions_failurePaired`: only these carry a non-null `failureCode`. */
export function requiresFailureCode(status: TransactionStatus): boolean {
  return status === "Failed" || status === "Declined";
}
