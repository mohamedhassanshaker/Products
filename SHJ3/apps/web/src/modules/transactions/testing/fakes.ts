/**
 * In-memory fakes for every `transactions` port, mirroring `identity/testing/
 * fakes.ts`'s and `iam/testing/fakes.ts`'s established convention.
 *
 * `FakePaymentGateway` is deliberately separate from the real
 * `MockPaymentGateway` adapter (`adapters/outbound/payment/mock-payment-
 * gateway.ts`) — the same "fake for unit tests, a distinct real-shaped
 * fixture for live/integration proof" split B-5 established for
 * `FakeChatModel` vs. `DeterministicChatModel`. This one is drivable to any
 * outcome with no async settling logic, for a use-case test that needs to
 * force a decline/refund-failure branch deterministically.
 */

import type { Money } from "../domain/money.js";
import { canTransitionTransaction, type TransactionStatus } from "../domain/transaction-status.js";
import type { RefundRequestedByKind, RefundStatus } from "../domain/refund-status.js";
import type {
  DeclineReason,
  GatewayEvent,
  GatewayRef,
  GatewayTransaction,
  IdempotencyKey,
  PaymentGateway,
  PaymentIntent,
  PaymentIntentOutcome,
  PaymentIntentRequest,
  PaymentMethod,
  RefundResult,
} from "../ports/payment-gateway.js";
import type {
  PaymentGatewayConfigRow,
  PaymentGatewayRegistryRepository,
} from "../ports/payment-gateway-registry-repository.js";
import type {
  PaymentEventRepository,
  PaymentEventRow,
  RecordPaymentEventResult,
} from "../ports/payment-event-repository.js";
import type {
  ReceiptConfigRepository,
  ReceiptConfigRow,
} from "../ports/receipt-config-repository.js";
import type {
  CreateRefundRequestResult,
  DecideRefundRequestResult,
  RefundRequestRepository,
  RefundRequestRow,
} from "../ports/refund-request-repository.js";
import type {
  CreateTransactionResult,
  TransactionFilter,
  TransactionRepository,
  TransactionRow,
} from "../ports/transaction-repository.js";

let idCounter = 0;
function fakeId(prefix: string): string {
  idCounter += 1;
  return `${prefix}_fake_${idCounter}`;
}

export class FakePaymentGateway implements PaymentGateway {
  readonly key = "fake-gateway";
  readonly mode: "Live" | "Sandbox" = "Sandbox";

  /** Set to force the next `createIntent` to this outcome kind instead of settling. */
  nextIntentOutcome: "settled" | "declined" = "settled";
  nextDeclineReason: DeclineReason = "gateway_declined";
  nextRefundOutcome: "refunded" | "declined" = "refunded";

  readonly intentCalls: PaymentIntentRequest[] = [];
  readonly refundCalls: { ref: GatewayRef; amount: Money }[] = [];

  async createIntent(request: PaymentIntentRequest, key: IdempotencyKey): Promise<PaymentIntent> {
    this.intentCalls.push(request);
    const gatewayReference = `fakepay_${key.value}`;
    const outcome: PaymentIntentOutcome =
      this.nextIntentOutcome === "declined"
        ? { kind: "declined", gatewayReference, reason: this.nextDeclineReason }
        : { kind: "settled", gatewayReference };
    return { gatewayReference, outcome };
  }

  async getTransaction(ref: GatewayRef): Promise<GatewayTransaction> {
    return {
      gatewayReference: ref.gatewayReference,
      outcome: { kind: "settled", gatewayReference: ref.gatewayReference },
    };
  }

  async refund(ref: GatewayRef, amount: Money, key: IdempotencyKey): Promise<RefundResult> {
    this.refundCalls.push({ ref, amount });
    if (this.nextRefundOutcome === "declined") {
      return {
        gatewayRefundReference: null,
        outcome: { kind: "declined", reason: "gateway_declined" },
      };
    }
    const gatewayRefundReference = `fakerefund_${key.value}`;
    return { gatewayRefundReference, outcome: { kind: "refunded", gatewayRefundReference } };
  }

  async parseCallback(
    rawBody: Uint8Array,
    _headers: ReadonlyMap<string, string>,
  ): Promise<GatewayEvent> {
    void _headers;
    const body = JSON.parse(new TextDecoder().decode(rawBody)) as {
      gatewayReference: string;
      kind: GatewayEvent["kind"];
      gatewayEventId?: string;
    };
    return {
      gatewayEventId: body.gatewayEventId ?? fakeId("evt"),
      gatewayReference: body.gatewayReference,
      kind: body.kind,
      occurredAt: new Date(),
      payloadRedactedJson: JSON.stringify(body),
    };
  }

  supportedMethods(): readonly PaymentMethod[] {
    return ["card", "apple_pay", "bank_transfer", "direct_debit"];
  }
}

export class FakeTransactionRepository implements TransactionRepository {
  readonly rows = new Map<string, TransactionRow>();

  seed(row: TransactionRow): void {
    this.rows.set(row.id, row);
  }

  async findById(id: string): Promise<TransactionRow | null> {
    return this.rows.get(id) ?? null;
  }

  async findByReference(reference: string): Promise<TransactionRow | null> {
    return [...this.rows.values()].find((r) => r.reference === reference) ?? null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<TransactionRow | null> {
    return [...this.rows.values()].find((r) => r.idempotencyKey === idempotencyKey) ?? null;
  }

  async list(filter: TransactionFilter, limit: number): Promise<readonly TransactionRow[]> {
    return [...this.rows.values()]
      .filter((r) => (filter.status ? r.status === filter.status : true))
      .filter((r) => (filter.serviceKey ? r.serviceKey === filter.serviceKey : true))
      .filter((r) => (filter.reference ? r.reference === filter.reference : true))
      .sort((a, b) => b.initiatedAt.getTime() - a.initiatedAt.getTime())
      .slice(0, limit);
  }

  async create(input: {
    readonly reference: string;
    readonly conversationId: string | null;
    readonly citizenIdentityId: string;
    readonly paymentGatewayId: string;
    readonly serviceKey: string;
    readonly serviceLabel: string;
    readonly linkedServiceAccountId: string | null;
    readonly amount: Money;
    readonly idempotencyKey: string;
    readonly assuranceLevelAtPayment: string;
    readonly now: Date;
  }): Promise<CreateTransactionResult> {
    // Mirrors `CK_Transactions_verifiedOnly` — the real adapter's belt-and-braces layer.
    if (input.assuranceLevelAtPayment === "Anonymous") {
      return { ok: false, reason: "payments.assurance_insufficient" };
    }
    const retentionExpiresAt = new Date(input.now.getTime());
    retentionExpiresAt.setUTCFullYear(retentionExpiresAt.getUTCFullYear() + 7);
    const row: TransactionRow = {
      id: fakeId("txn"),
      reference: input.reference,
      conversationId: input.conversationId,
      citizenIdentityId: input.citizenIdentityId,
      paymentGatewayId: input.paymentGatewayId,
      serviceKey: input.serviceKey,
      serviceLabel: input.serviceLabel,
      linkedServiceAccountId: input.linkedServiceAccountId,
      amount: input.amount,
      status: "Initiated",
      gatewayReference: null,
      idempotencyKey: input.idempotencyKey,
      assuranceLevelAtPayment: input.assuranceLevelAtPayment,
      initiatedAt: input.now,
      settledAt: null,
      failureCode: null,
      retentionExpiresAt,
    };
    this.rows.set(row.id, row);
    return { ok: true, transaction: row };
  }

  private transition(
    id: string,
    to: TransactionStatus,
    patch: Partial<TransactionRow>,
  ): TransactionRow {
    const existing = this.rows.get(id);
    if (!existing) throw new Error(`Unknown transaction "${id}".`);
    if (!canTransitionTransaction(existing.status, to)) {
      throw new Error(`Invalid transaction transition ${existing.status} -> ${to}.`);
    }
    const updated: TransactionRow = { ...existing, status: to, ...patch };
    this.rows.set(id, updated);
    return updated;
  }

  async settle(id: string, gatewayReference: string, now: Date): Promise<TransactionRow> {
    return this.transition(id, "Settled", { gatewayReference, settledAt: now });
  }

  async fail(id: string, failureCode: string, now: Date): Promise<TransactionRow> {
    void now;
    return this.transition(id, "Failed", { failureCode });
  }

  async decline(id: string, failureCode: string, now: Date): Promise<TransactionRow> {
    void now;
    return this.transition(id, "Declined", { failureCode });
  }

  async markRefundRequested(id: string, now: Date): Promise<TransactionRow> {
    void now;
    return this.transition(id, "RefundRequested", {});
  }

  async resolveRefund(
    id: string,
    outcome: "Refunded" | "Settled",
    now: Date,
  ): Promise<TransactionRow> {
    void now;
    return this.transition(id, outcome, {});
  }
}

export class FakeRefundRequestRepository implements RefundRequestRepository {
  readonly rows = new Map<string, RefundRequestRow>();

  async findPendingForTransaction(transactionId: string): Promise<RefundRequestRow | null> {
    return (
      [...this.rows.values()].find(
        (r) => r.transactionId === transactionId && r.status === "Pending",
      ) ?? null
    );
  }

  async listPending(): Promise<readonly RefundRequestRow[]> {
    return [...this.rows.values()]
      .filter((r) => r.status === "Pending")
      .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  }

  async findById(id: string): Promise<RefundRequestRow | null> {
    return this.rows.get(id) ?? null;
  }

  async create(input: {
    readonly transactionId: string;
    readonly requestedByKind: RefundRequestedByKind;
    readonly requestedByStaffUserId: string | null;
    readonly reason: string;
    readonly amountMinor: bigint;
    readonly now: Date;
  }): Promise<CreateRefundRequestResult> {
    const existing = await this.findPendingForTransaction(input.transactionId);
    if (existing) return { ok: false, reason: "payments.refund_already_pending" };

    const row: RefundRequestRow = {
      id: fakeId("refund"),
      transactionId: input.transactionId,
      requestedByKind: input.requestedByKind,
      requestedByStaffUserId: input.requestedByStaffUserId,
      reason: input.reason,
      amountMinor: input.amountMinor,
      status: "Pending",
      decidedByStaffUserId: null,
      decidedAt: null,
      decisionNote: null,
      requestedAt: input.now,
    };
    this.rows.set(row.id, row);
    return { ok: true, refund: row };
  }

  async decide(input: {
    readonly id: string;
    readonly outcome: "Approved" | "Declined";
    readonly decidedByStaffUserId: string;
    readonly decisionNote: string | null;
    readonly now: Date;
  }): Promise<DecideRefundRequestResult> {
    const existing = this.rows.get(input.id);
    if (!existing) return { ok: false, reason: "payments.refund_not_requested" };
    if (existing.status !== "Pending")
      return { ok: false, reason: "payments.refund_already_resolved" };

    const updated: RefundRequestRow = {
      ...existing,
      status: input.outcome as RefundStatus,
      decidedByStaffUserId: input.decidedByStaffUserId,
      decidedAt: input.now,
      decisionNote: input.decisionNote,
    };
    this.rows.set(input.id, updated);
    return { ok: true, refund: updated };
  }
}

export class FakePaymentEventRepository implements PaymentEventRepository {
  readonly rows: PaymentEventRow[] = [];

  async record(input: {
    readonly transactionId: string;
    readonly kind: string;
    readonly gatewayEventId: string;
    readonly payloadRedactedJson: string;
    readonly signatureVerified: true;
    readonly occurredAt: Date;
    readonly now: Date;
  }): Promise<RecordPaymentEventResult> {
    if (this.rows.some((r) => r.gatewayEventId === input.gatewayEventId)) {
      return { ok: false, reason: "payments.event_already_recorded" };
    }
    const row: PaymentEventRow = {
      id: fakeId("payevt"),
      transactionId: input.transactionId,
      kind: input.kind,
      gatewayEventId: input.gatewayEventId,
      payloadRedactedJson: input.payloadRedactedJson,
      signatureVerified: input.signatureVerified,
      occurredAt: input.occurredAt,
      receivedAt: input.now,
    };
    this.rows.push(row);
    return { ok: true, event: row };
  }

  async listForTransaction(transactionId: string): Promise<readonly PaymentEventRow[]> {
    return this.rows.filter((r) => r.transactionId === transactionId);
  }
}

export class FakePaymentGatewayRegistryRepository implements PaymentGatewayRegistryRepository {
  readonly rows = new Map<string, PaymentGatewayConfigRow>();

  seed(row: PaymentGatewayConfigRow): void {
    this.rows.set(row.key, row);
  }

  async list(): Promise<readonly PaymentGatewayConfigRow[]> {
    return [...this.rows.values()];
  }

  async findByKey(key: string): Promise<PaymentGatewayConfigRow | null> {
    return this.rows.get(key) ?? null;
  }

  async setEnabledMethods(input: {
    readonly key: string;
    readonly isEnabled: boolean;
    readonly methods: readonly string[];
    readonly now: Date;
  }): Promise<PaymentGatewayConfigRow> {
    const existing = this.rows.get(input.key);
    if (!existing) throw new Error(`Unknown payment gateway "${input.key}".`);
    const updated = { ...existing, isEnabled: input.isEnabled, methods: input.methods };
    this.rows.set(input.key, updated);
    return updated;
  }
}

export class FakeReceiptConfigRepository implements ReceiptConfigRepository {
  private row: ReceiptConfigRow = {
    sendInConversation: true,
    emailPdfCopy: false,
    allowRefundRequestsFromAssistant: false,
  };

  async get(): Promise<ReceiptConfigRow> {
    return this.row;
  }

  async set(input: {
    readonly sendInConversation: boolean;
    readonly emailPdfCopy: boolean;
    readonly allowRefundRequestsFromAssistant: boolean;
    readonly now: Date;
  }): Promise<ReceiptConfigRow> {
    void input.now;
    this.row = {
      sendInConversation: input.sendInConversation,
      emailPdfCopy: input.emailPdfCopy,
      allowRefundRequestsFromAssistant: input.allowRefundRequestsFromAssistant,
    };
    return this.row;
  }
}
