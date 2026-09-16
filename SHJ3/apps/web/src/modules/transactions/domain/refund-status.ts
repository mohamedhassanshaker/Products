/**
 * `RefundRequests.status` — B11 tab 4's pending item and its resolution.
 * `CK_RefundRequests_decidedPaired`: `Pending` carries no decider; `Approved`/
 * `Declined` both require one.
 */

export const REFUND_STATUSES = ["Pending", "Approved", "Declined"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export function isRefundStatus(value: string): value is RefundStatus {
  return (REFUND_STATUSES as readonly string[]).includes(value);
}

export const REFUND_REQUESTED_BY_KINDS = ["Citizen", "LiveAgent", "BackOffice"] as const;
export type RefundRequestedByKind = (typeof REFUND_REQUESTED_BY_KINDS)[number];
