import { afterEach, describe, expect, it, vi } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { recordAuditEntry } from "@nextbot/audit";
import { generateId } from "@nextbot/db";

const testUserId = generateId();

vi.mock("server-only", () => ({}));

let ctx: TenantContext;
afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
});

async function mockSessionAsRead() {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () => ({
      permissions: { audit_log: "Read" },
      tenantId: ctx.tenantId,
      userId: testUserId,
      roleIds: ["role-1"],
    }),
    getSessionTenantContext: async () => ctx,
  }));
}

/**
 * Regression test for QA fix UI-D2: a PII-containing audit entry's `details`
 * field must be masked in the *API response* both the list/detail-drawer fetch
 * and the export path actually use — not just in some code path the UI never
 * calls (the original gap: a `.../{id}/masked` endpoint was documented as the
 * fix but never built, while the real list/export routes kept returning raw
 * `details`).
 */
describe("Audit Log masking (QA fix UI-D2, real Postgres)", () => {
  it("masks a PII-containing details field in GET /audit-log's response", async () => {
    ctx = await createFixtureTenant();
    const rawEmail = "jane.doe@example.com";
    await recordAuditEntry(ctx, {
      actorId: testUserId,
      actorLabel: "Jane Doe",
      actionType: "dsr.export",
      targetType: "customer",
      targetId: "cust-1",
      outcome: "Success",
      details: { customerEmail: rawEmail, note: "requested full export" },
    });

    await mockSessionAsRead();
    const { GET } = await import("./route.js");
    const res = await GET(new (await import("next/server")).NextRequest("http://localhost/api/v1/admin/audit-log"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entries.length).toBe(1);
    // The raw email must never appear in the response's details blob.
    expect(JSON.stringify(body.entries[0].details)).not.toContain(rawEmail);
  });

  it("masks a PII-containing details field in the CSV export's response", async () => {
    ctx = await createFixtureTenant();
    const rawEmail = "export-pii@example.com";
    await recordAuditEntry(ctx, {
      actorId: testUserId,
      actorLabel: "Jane Doe",
      actionType: "dsr.export",
      targetType: "customer",
      targetId: "cust-2",
      outcome: "Success",
      details: { customerEmail: rawEmail },
    });

    await mockSessionAsRead();
    const { GET } = await import("./export/route.js");
    const res = await GET(new (await import("next/server")).NextRequest("http://localhost/api/v1/admin/audit-log/export?format=csv"));
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain(rawEmail);
  });
});
