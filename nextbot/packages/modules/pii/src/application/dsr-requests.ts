import { and, desc, eq } from "drizzle-orm";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Phase 17 (BL-10, B.8.4) — the `data_subject_request` record-keeping surface. This
 * module owns only the request *lifecycle* record; the actual cross-module
 * search/export/delete work (conversations, escalations, ...) is orchestrated by
 * `apps/web`'s composition-root DSR service, since `pii` cannot import those
 * modules directly (LLD §2.3's allow-list: `pii: ["tenancy"]`).
 */
export type DsrType = "Search" | "Export" | "Delete";
export type DsrStatus = "Pending" | "InProgress" | "Completed" | "Failed";

export interface DsrRequestRow {
  id: string;
  requestType: DsrType;
  customerIdentifier: string;
  requestedByUserId: string | null;
  status: DsrStatus;
  resultSummary: Record<string, unknown> | null;
  createdAt: Date;
  completedAt: Date | null;
}

export async function createDsrRequest(
  ctx: TenantContext,
  input: { requestType: DsrType; customerIdentifier: string; requestedByUserId: string | null },
): Promise<string> {
  const id = generateId();
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.dataSubjectRequest).values({ id, tenantId: ctx.tenantId, ...input });
  });
  return id;
}

export async function completeDsrRequest(
  ctx: TenantContext,
  id: string,
  outcome: { status: "Completed" | "Failed"; resultSummary: Record<string, unknown> },
): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db
      .update(schema.dataSubjectRequest)
      .set({ status: outcome.status, resultSummary: outcome.resultSummary, completedAt: new Date() })
      .where(and(eq(schema.dataSubjectRequest.tenantId, ctx.tenantId), eq(schema.dataSubjectRequest.id, id)));
  });
}

export async function listDsrRequests(ctx: TenantContext): Promise<DsrRequestRow[]> {
  return withTenant(ctx, async (db: TenantScopedClient) => {
    const rows = await db
      .select()
      .from(schema.dataSubjectRequest)
      .where(eq(schema.dataSubjectRequest.tenantId, ctx.tenantId))
      .orderBy(desc(schema.dataSubjectRequest.createdAt));
    return rows.map((r) => ({
      id: r.id,
      requestType: r.requestType,
      customerIdentifier: r.customerIdentifier,
      requestedByUserId: r.requestedByUserId,
      status: r.status,
      resultSummary: (r.resultSummary as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt,
      completedAt: r.completedAt,
    }));
  });
}
