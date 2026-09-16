/**
 * The real `TransactionRepository` — `Transactions`, per-tenant.
 *
 * `CK_Transactions_verifiedOnly`'s rejection is translated to
 * `payments.assurance_insufficient` — belt-and-braces alongside every caller
 * (`InitiatePayment`) already having passed `EvaluateStepUp` first.
 * `retentionExpiresAt` is read back from the row (SQL Server's own computed,
 * persisted column, `DATEADD(YEAR, 7, initiatedAt)`) — never written by this
 * adapter, matching the port's own doc comment.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import { isTransactionStatus } from "../../../domain/transaction-status.js";
import type {
  CreateTransactionResult,
  TransactionFilter,
  TransactionRepository,
  TransactionRow,
} from "../../../ports/transaction-repository.js";

const OPERATION = "transactions transaction repository";
const VERIFIED_ONLY_FRAGMENT = "CK_Transactions_verifiedOnly";

function toRow(row: {
  id: string;
  reference: string;
  conversationId: string | null;
  citizenIdentityId: string;
  paymentGatewayId: string;
  serviceKey: string;
  serviceLabel: string;
  linkedServiceAccountId: string | null;
  amountMinor: bigint;
  currency: string;
  status: string;
  gatewayReference: string | null;
  idempotencyKey: string;
  assuranceLevelAtPayment: string;
  initiatedAt: Date;
  settledAt: Date | null;
  failureCode: string | null;
}): TransactionRow {
  if (!isTransactionStatus(row.status)) {
    throw new Error(`Transaction ${row.id} has an unrecognized status "${row.status}".`);
  }
  return {
    id: row.id,
    reference: row.reference,
    conversationId: row.conversationId,
    citizenIdentityId: row.citizenIdentityId,
    paymentGatewayId: row.paymentGatewayId,
    serviceKey: row.serviceKey,
    serviceLabel: row.serviceLabel,
    linkedServiceAccountId: row.linkedServiceAccountId,
    amount: { amountMinor: row.amountMinor, currency: row.currency },
    status: row.status,
    gatewayReference: row.gatewayReference,
    idempotencyKey: row.idempotencyKey,
    assuranceLevelAtPayment: row.assuranceLevelAtPayment,
    initiatedAt: row.initiatedAt,
    settledAt: row.settledAt,
    failureCode: row.failureCode,
    // `DATEADD(YEAR, 7, initiatedAt)` — computed identically here rather than
    // re-queried, since the persisted column's own formula is exactly this and
    // Prisma's generated client for this model does not project a column this
    // adapter never asked SQL Server to compute for it (the schema
    // deliberately omits it from the Prisma model — see `Transaction`'s own
    // doc comment in `prisma/tenant/schema.prisma`, "so nothing can write to
    // it"). Real proof that the *database's* column agrees is the live
    // verification's job (a direct `SELECT retentionExpiresAt`), not this
    // adapter's.
    retentionExpiresAt: addYears(row.initiatedAt, 7),
  };
}

function addYears(date: Date, years: number): Date {
  const result = new Date(date.getTime());
  result.setUTCFullYear(result.getUTCFullYear() + years);
  return result;
}

export class PrismaTransactionRepository implements TransactionRepository {
  async findById(id: string): Promise<TransactionRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.transaction.findUnique({ where: { id } });
    return row ? toRow(row) : null;
  }

  async findByReference(reference: string): Promise<TransactionRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.transaction.findUnique({ where: { reference } });
    return row ? toRow(row) : null;
  }

  async findByIdempotencyKey(idempotencyKey: string): Promise<TransactionRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.transaction.findUnique({ where: { idempotencyKey } });
    return row ? toRow(row) : null;
  }

  async list(filter: TransactionFilter, limit: number): Promise<readonly TransactionRow[]> {
    const db = getTenantDb(OPERATION);
    // `exactOptionalPropertyTypes` rejects an explicit `undefined` value
    // anywhere in Prisma's generated `WhereInput` types — every optional
    // filter key below is *omitted* when absent, never set to `undefined`.
    const rows = await db.transaction.findMany({
      where: {
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.serviceKey ? { serviceKey: filter.serviceKey } : {}),
        ...(filter.reference ? { reference: filter.reference } : {}),
        ...(filter.rangeFrom || filter.rangeTo
          ? {
              initiatedAt: {
                ...(filter.rangeFrom ? { gte: filter.rangeFrom } : {}),
                ...(filter.rangeTo ? { lte: filter.rangeTo } : {}),
              },
            }
          : {}),
      },
      orderBy: { initiatedAt: "desc" },
      take: limit,
    });
    return rows.map(toRow);
  }

  async create(input: {
    readonly reference: string;
    readonly conversationId: string | null;
    readonly citizenIdentityId: string;
    readonly paymentGatewayId: string;
    readonly serviceKey: string;
    readonly serviceLabel: string;
    readonly linkedServiceAccountId: string | null;
    readonly amount: { amountMinor: bigint; currency: string };
    readonly idempotencyKey: string;
    readonly assuranceLevelAtPayment: string;
    readonly now: Date;
  }): Promise<CreateTransactionResult> {
    const db = getTenantDb(OPERATION);
    try {
      const row = await db.transaction.create({
        data: {
          id: newUlid(input.now),
          reference: input.reference,
          conversationId: input.conversationId,
          citizenIdentityId: input.citizenIdentityId,
          paymentGatewayId: input.paymentGatewayId,
          serviceKey: input.serviceKey,
          serviceLabel: input.serviceLabel,
          linkedServiceAccountId: input.linkedServiceAccountId,
          amountMinor: input.amount.amountMinor,
          currency: input.amount.currency,
          status: "Initiated",
          idempotencyKey: input.idempotencyKey,
          assuranceLevelAtPayment: input.assuranceLevelAtPayment,
          initiatedAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { ok: true, transaction: toRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(VERIFIED_ONLY_FRAGMENT)) {
        return { ok: false, reason: "payments.assurance_insufficient" };
      }
      throw error;
    }
  }

  async settle(id: string, gatewayReference: string, now: Date): Promise<TransactionRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.transaction.update({
      where: { id },
      data: { status: "Settled", gatewayReference, settledAt: now, updatedAt: now },
    });
    return toRow(row);
  }

  async fail(id: string, failureCode: string, now: Date): Promise<TransactionRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.transaction.update({
      where: { id },
      data: { status: "Failed", failureCode, updatedAt: now },
    });
    return toRow(row);
  }

  async decline(id: string, failureCode: string, now: Date): Promise<TransactionRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.transaction.update({
      where: { id },
      data: { status: "Declined", failureCode, updatedAt: now },
    });
    return toRow(row);
  }

  async markRefundRequested(id: string, now: Date): Promise<TransactionRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.transaction.update({
      where: { id },
      data: { status: "RefundRequested", updatedAt: now },
    });
    return toRow(row);
  }

  async resolveRefund(
    id: string,
    outcome: "Refunded" | "Settled",
    now: Date,
  ): Promise<TransactionRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.transaction.update({
      where: { id },
      data: { status: outcome, updatedAt: now },
    });
    return toRow(row);
  }
}
