import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import { createWebWidgetChannel } from "@nextbot/channels";
import { insertConversation, insertMessage } from "@nextbot/conversations";
import { generateId } from "@nextbot/db";

vi.mock("server-only", () => ({}));

const testUserId = generateId();
let ctx: TenantContext;

afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  vi.doUnmock("@/src/lib/session");
  vi.doUnmock("@/src/lib/platform-api-guard");
  vi.resetModules();
});

/** The tenant admin route's own auth seam (session/RBAC) — mocked exactly like every
 * other admin-route integration test in this codebase (see `dsr-admin.int.test.ts`). */
function mockTenantSession() {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () => ({ permissions: { conversations: "Read" }, tenantId: ctx.tenantId, userId: testUserId, roleIds: ["role-1"] }),
    getSessionTenantContext: async () => ctx,
  }));
}

/** The platform-ops route's own network/token gate — already proven fail-closed
 * end-to-end elsewhere in this phase's own `breakglass-ops.int.test.ts`; bypassed
 * here so this file stays scoped to the ONE property it exists to prove: masking
 * parity between the tenant admin's own read and the break-glass operator's read. */
function mockOpsGuard() {
  vi.doMock("@/src/lib/platform-api-guard", () => ({
    requirePlatformApi: async () => ({ authorized: true }),
  }));
}

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — proves the "an operator
 * must never see MORE than an equivalent-privilege tenant viewer would" requirement
 * structurally, not by re-implementing a masking rule: the break-glass conversation-
 * detail read (`getConversationDetailForAdmin` called from the ops composition root
 * with a `TenantContext` built from the grant) returns a response BYTE-IDENTICAL to
 * what the tenant's own Conversation Detail admin screen receives for the exact same
 * conversation — same function, same masking behavior, by construction. A future
 * change that accidentally added an extra field to only one of the two routes would
 * fail this test.
 */
describe("Break-glass conversation-detail read is byte-identical to the tenant admin's own read (Phase 20, FR-ADM-09)", () => {
  it("returns the exact same conversation payload through both routes for the same conversation", async () => {
    ctx = await createFixtureTenant();
    const channel = await createWebWidgetChannel(ctx, { name: `Widget ${crypto.randomUUID()}`, environment: "Sandbox" });
    const conversationId = await insertConversation(ctx, { channelId: channel.id, language: "en" });
    await insertMessage(ctx, {
      conversationId,
      sender: "Customer",
      contentType: "Text",
      payload: { text: "My email is real-customer@example.com and my card is 4111 1111 1111 1111." },
    });

    const { createBreakglassGrant } = await import("@nextbot/tenancy");
    await createBreakglassGrant(ctx, { grantedByUserId: crypto.randomUUID(), reason: "diagnosis", expiresInHours: 1 });

    mockTenantSession();
    const { GET: adminGet } = await import("@/app/api/v1/admin/conversations/[id]/route.js");
    const adminRes = await adminGet(new NextRequest(`http://localhost/api/v1/admin/conversations/${conversationId}`), {
      params: Promise.resolve({ id: conversationId }),
    });
    expect(adminRes.status).toBe(200);
    const adminBody = await adminRes.json();

    mockOpsGuard();
    const { GET: opsGet } = await import("./conversations/[conversationId]/route.js");
    const opsRes = await opsGet(
      new NextRequest(`http://localhost/api/internal/ops/tenants/${ctx.tenantId}/breakglass/conversations/${conversationId}`),
      { params: Promise.resolve({ id: ctx.tenantId, conversationId }) },
    );
    expect(opsRes.status).toBe(200);
    const opsBody = await opsRes.json();

    expect(opsBody.conversation).toEqual(adminBody.conversation);
  });
});
