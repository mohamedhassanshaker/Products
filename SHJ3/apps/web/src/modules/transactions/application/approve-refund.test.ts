import { describe, expect, it } from "vitest";
import { ApproveRefund } from "./approve-refund.js";
import { DeclineRefund } from "./decline-refund.js";
import { RequestRefund } from "./request-refund.js";
import {
  FakePaymentEventRepository,
  FakePaymentGateway,
  FakeRefundRequestRepository,
  FakeTransactionRepository,
} from "../testing/fakes.js";
import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";

const NOW = new Date("2026-09-09T12:00:00.000Z");

const STAFF: Principal = {
  id: "staff_1",
  tenant: "sewa" as never,
  displayName: "Super Admin",
  roles: ["SuperAdmin"],
  permissions: new Set(["users:manage"]),
  assurance: "L0",
};

function fakeAudit(): AuditSink & { entries: unknown[] } {
  const entries: unknown[] = [];
  return {
    entries,
    async record(entry) {
      entries.push(entry);
    },
  };
}

async function settledTransaction(transactions: FakeTransactionRepository) {
  const created = await transactions.create({
    reference: "TXN-1",
    conversationId: "conv_1",
    citizenIdentityId: "cid_1",
    paymentGatewayId: "pg_1",
    serviceKey: "sewa_bill",
    serviceLabel: "SEWA bill",
    linkedServiceAccountId: null,
    amount: { amountMinor: 41_200n, currency: "AED" },
    idempotencyKey: "idem-1",
    assuranceLevelAtPayment: "VerifiedPlusOtp",
    now: NOW,
  });
  if (!created.ok) throw new Error("fixture setup failed");
  return transactions.settle(created.transaction.id, "gw_ref_1", NOW);
}

describe("RequestRefund -> ApproveRefund", () => {
  it("real, working end to end: request, then approve — the transaction reaches Refunded", async () => {
    const transactions = new FakeTransactionRepository();
    const refunds = new FakeRefundRequestRepository();
    const gateway = new FakePaymentGateway();
    const events = new FakePaymentEventRepository();
    const audit = fakeAudit();

    const transaction = await settledTransaction(transactions);

    const requestUseCase = new RequestRefund({ transactions, refunds });
    const requested = await requestUseCase.execute({
      transactionReference: transaction.reference,
      requestedByKind: "Citizen",
      requestedByStaffUserId: null,
      reason: "Overcharged",
      amountMinor: 41_200n,
      now: NOW,
    });
    expect(requested.ok).toBe(true);
    expect((await transactions.findById(transaction.id))?.status).toBe("RefundRequested");

    if (!requested.ok) return;
    const approveUseCase = new ApproveRefund({ gateway, refunds, transactions, events, audit });
    const approved = await approveUseCase.execute({
      refundRequestId: requested.refund.id,
      actor: STAFF,
      now: NOW,
    });

    expect(approved.ok).toBe(true);
    expect((await transactions.findById(transaction.id))?.status).toBe("Refunded");
    expect(gateway.refundCalls).toHaveLength(1);
    expect(events.rows.some((e) => e.kind === "refund_settled")).toBe(true);
    expect(audit.entries).toHaveLength(1);
  });

  it("a second pending refund request on the same transaction is refused", async () => {
    const transactions = new FakeTransactionRepository();
    const refunds = new FakeRefundRequestRepository();
    const transaction = await settledTransaction(transactions);
    const useCase = new RequestRefund({ transactions, refunds });

    const first = await useCase.execute({
      transactionReference: transaction.reference,
      requestedByKind: "Citizen",
      requestedByStaffUserId: null,
      reason: "Overcharged",
      amountMinor: 41_200n,
      now: NOW,
    });
    expect(first.ok).toBe(true);

    const second = await useCase.execute({
      transactionReference: transaction.reference,
      requestedByKind: "Citizen",
      requestedByStaffUserId: null,
      reason: "Overcharged again",
      amountMinor: 41_200n,
      now: NOW,
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("payments.refund_already_pending");
  });

  it("decline restores the transaction to Settled — no gateway call", async () => {
    const transactions = new FakeTransactionRepository();
    const refunds = new FakeRefundRequestRepository();
    const audit = fakeAudit();
    const transaction = await settledTransaction(transactions);
    const requested = await new RequestRefund({ transactions, refunds }).execute({
      transactionReference: transaction.reference,
      requestedByKind: "Citizen",
      requestedByStaffUserId: null,
      reason: "Overcharged",
      amountMinor: 41_200n,
      now: NOW,
    });
    if (!requested.ok) throw new Error("fixture setup failed");

    const declineUseCase = new DeclineRefund({ refunds, transactions, audit });
    const declined = await declineUseCase.execute({
      refundRequestId: requested.refund.id,
      reason: "Not eligible",
      actor: STAFF,
      now: NOW,
    });

    expect(declined.ok).toBe(true);
    expect((await transactions.findById(transaction.id))?.status).toBe("Settled");
    expect(audit.entries).toHaveLength(1);
  });

  it("a failed gateway call leaves both rows unchanged rather than lying about a refund that did not happen", async () => {
    const transactions = new FakeTransactionRepository();
    const refunds = new FakeRefundRequestRepository();
    const gateway = new FakePaymentGateway();
    gateway.nextRefundOutcome = "declined";
    const events = new FakePaymentEventRepository();
    const audit = fakeAudit();
    const transaction = await settledTransaction(transactions);
    const requested = await new RequestRefund({ transactions, refunds }).execute({
      transactionReference: transaction.reference,
      requestedByKind: "Citizen",
      requestedByStaffUserId: null,
      reason: "Overcharged",
      amountMinor: 41_200n,
      now: NOW,
    });
    if (!requested.ok) throw new Error("fixture setup failed");

    const approveUseCase = new ApproveRefund({ gateway, refunds, transactions, events, audit });
    const approved = await approveUseCase.execute({
      refundRequestId: requested.refund.id,
      actor: STAFF,
      now: NOW,
    });

    expect(approved.ok).toBe(false);
    if (!approved.ok) expect(approved.reason).toBe("payments.gateway_refund_failed");
    expect((await transactions.findById(transaction.id))?.status).toBe("RefundRequested");
    expect((await refunds.findById(requested.refund.id))?.status).toBe("Pending");
    expect(audit.entries).toHaveLength(0);
  });
});
