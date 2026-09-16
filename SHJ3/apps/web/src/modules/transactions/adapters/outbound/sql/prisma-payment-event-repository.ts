/**
 * The real `PaymentEventRepository` — `PaymentEvents`, per-tenant.
 * `UQ_PaymentEvents_gatewayEventId` is the real idempotency mechanism; the
 * unique-constraint violation is translated to `payments.event_already_
 * recorded` rather than surfaced as a raw database error.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  PaymentEventRepository,
  PaymentEventRow,
  RecordPaymentEventResult,
} from "../../../ports/payment-event-repository.js";

const OPERATION = "transactions payment-event repository";

function toRow(row: {
  id: string;
  transactionId: string;
  kind: string;
  gatewayEventId: string;
  payloadRedactedJson: string;
  signatureVerified: boolean;
  occurredAt: Date;
  receivedAt: Date;
}): PaymentEventRow {
  return { ...row };
}

export class PrismaPaymentEventRepository implements PaymentEventRepository {
  async record(input: {
    readonly transactionId: string;
    readonly kind: string;
    readonly gatewayEventId: string;
    readonly payloadRedactedJson: string;
    readonly signatureVerified: true;
    readonly occurredAt: Date;
    readonly now: Date;
  }): Promise<RecordPaymentEventResult> {
    const db = getTenantDb(OPERATION);
    const existing = await db.paymentEvent.findUnique({
      where: { gatewayEventId: input.gatewayEventId },
    });
    if (existing) return { ok: false, reason: "payments.event_already_recorded" };

    const row = await db.paymentEvent.create({
      data: {
        id: newUlid(input.now),
        transactionId: input.transactionId,
        kind: input.kind,
        gatewayEventId: input.gatewayEventId,
        payloadRedactedJson: input.payloadRedactedJson,
        signatureVerified: input.signatureVerified,
        occurredAt: input.occurredAt,
        receivedAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return { ok: true, event: toRow(row) };
  }

  async listForTransaction(transactionId: string): Promise<readonly PaymentEventRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.paymentEvent.findMany({
      where: { transactionId },
      orderBy: { occurredAt: "asc" },
    });
    return rows.map(toRow);
  }
}
