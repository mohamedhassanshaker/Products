/**
 * The real `RefundRequestRepository` — `RefundRequests`, per-tenant.
 *
 * `UQ_RefundRequests_pendingPerTransaction` carries no Prisma `@@unique` (a
 * filtered index, raw SQL only — the identical shape `ToolBindings`'
 * per-target-kind unique indexes already established in this codebase), so
 * `create()` checks for an existing `Pending` row first rather than relying on
 * a caught unique-constraint error. `TR_RefundRequests_amountWithinTransaction`'s
 * THROW text is matched by substring, the same pattern
 * `PrismaToolBindingRepository` already uses for its own trigger rejections.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { isRefundStatus, type RefundRequestedByKind } from "../../../domain/refund-status.js";
import type {
  CreateRefundRequestResult,
  DecideRefundRequestResult,
  RefundRequestRepository,
  RefundRequestRow,
} from "../../../ports/refund-request-repository.js";

const OPERATION = "transactions refund-request repository";
const AMOUNT_WITHIN_TRANSACTION_FRAGMENT = "cannot exceed the settled transaction amount";

function toRow(row: {
  id: string;
  transactionId: string;
  requestedByKind: string;
  requestedByStaffUserId: string | null;
  reason: string;
  amountMinor: bigint;
  status: string;
  decidedByStaffUserId: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  requestedAt: Date;
}): RefundRequestRow {
  if (!isRefundStatus(row.status)) {
    throw new Error(`RefundRequest ${row.id} has an unrecognized status "${row.status}".`);
  }
  return {
    id: row.id,
    transactionId: row.transactionId,
    requestedByKind: row.requestedByKind as RefundRequestedByKind,
    requestedByStaffUserId: row.requestedByStaffUserId,
    reason: row.reason,
    amountMinor: row.amountMinor,
    status: row.status,
    decidedByStaffUserId: row.decidedByStaffUserId,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    requestedAt: row.requestedAt,
  };
}

export class PrismaRefundRequestRepository implements RefundRequestRepository {
  async findPendingForTransaction(transactionId: string): Promise<RefundRequestRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.refundRequest.findFirst({ where: { transactionId, status: "Pending" } });
    return row ? toRow(row) : null;
  }

  async findById(id: string): Promise<RefundRequestRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.refundRequest.findUnique({ where: { id } });
    return row ? toRow(row) : null;
  }

  async listPending(): Promise<readonly RefundRequestRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.refundRequest.findMany({
      where: { status: "Pending" },
      orderBy: { requestedAt: "asc" },
    });
    return rows.map(toRow);
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

    const db = getTenantDb(OPERATION);
    try {
      const row = await db.refundRequest.create({
        data: {
          id: newUlid(input.now),
          transactionId: input.transactionId,
          requestedByKind: input.requestedByKind,
          requestedByStaffUserId: input.requestedByStaffUserId,
          reason: input.reason,
          amountMinor: input.amountMinor,
          status: "Pending",
          requestedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { ok: true, refund: toRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(AMOUNT_WITHIN_TRANSACTION_FRAGMENT)) {
        return { ok: false, reason: "payments.amount_mismatch" };
      }
      throw error;
    }
  }

  async decide(input: {
    readonly id: string;
    readonly outcome: "Approved" | "Declined";
    readonly decidedByStaffUserId: string;
    readonly decisionNote: string | null;
    readonly now: Date;
  }): Promise<DecideRefundRequestResult> {
    const existing = await this.findById(input.id);
    if (!existing) return { ok: false, reason: "payments.refund_not_requested" };
    if (existing.status !== "Pending")
      return { ok: false, reason: "payments.refund_already_resolved" };

    const db = getTenantDb(OPERATION);
    const row = await db.refundRequest.update({
      where: { id: input.id },
      data: {
        status: input.outcome,
        decidedByStaffUserId: input.decidedByStaffUserId,
        decidedAt: input.now,
        decisionNote: input.decisionNote,
        updatedAt: input.now,
      },
    });
    return { ok: true, refund: toRow(row) };
  }
}
