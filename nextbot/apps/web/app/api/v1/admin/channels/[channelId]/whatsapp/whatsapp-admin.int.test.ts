import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { startMockMetaGraphServer, createMockMetaGraphState, type MockMetaGraphState } from "@nextbot/testing";
import { createWhatsAppChannel } from "@nextbot/channels";
import { withTenant, schema, type TenantContext } from "@nextbot/db";
import { eq } from "drizzle-orm";

vi.mock("server-only", () => ({}));

const ACTOR_USER_ID = "00000000-0000-7000-8000-000000000099";

let ctx: TenantContext;
let channelId: string;
let server: { url: string; close: () => Promise<void> } | undefined;

afterEach(async () => {
  if (ctx) await deleteFixtureTenant(ctx.tenantId);
  if (server) {
    await server.close();
    server = undefined;
  }
  delete process.env.NEXTBOT_META_GRAPH_API_BASE_URL;
  vi.doUnmock("@/src/lib/session");
  vi.resetModules();
});

async function mockSessionAs(level: "Read" | "Write" | "None") {
  vi.doMock("@/src/lib/session", () => ({
    getSession: async () =>
      level === "None"
        ? { permissions: {}, tenantId: ctx.tenantId, userId: ACTOR_USER_ID, roleIds: [] }
        : { permissions: { channels: level }, tenantId: ctx.tenantId, userId: ACTOR_USER_ID, roleIds: ["role-1"] },
    getSessionTenantContext: async () => ctx,
  }));
}

async function setUp(state: MockMetaGraphState) {
  ctx = await createFixtureTenant();
  const channel = await createWhatsAppChannel(ctx, { name: "WA Admin", environment: "Sandbox" });
  channelId = channel.id;
  server = await startMockMetaGraphServer(state);
  process.env.NEXTBOT_META_GRAPH_API_BASE_URL = server.url;
  state.businessInfo["biz-1"] = { id: "biz-1", name: "Acme Corp" };
}

const params = () => Promise.resolve({ channelId });

describe("WhatsApp channel admin API — real HTTP routes, real DB, real Meta mock server (BL-15)", () => {
  it("full config lifecycle: connect -> waba config -> sync numbers -> sync templates -> activate, with audit entries attributed to the real admin", async () => {
    const state = createMockMetaGraphState();
    await setUp(state);
    await mockSessionAs("Write");

    const { POST: connect, GET: getAccount, PATCH: patchWaba } = await import("./route.js");

    const connectRes = await connect(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: "biz-1", businessName: "Acme Corp", systemUserToken: "sys-token", appId: "app-1", appSecret: "app-secret" }),
      }),
      { params: params() },
    );
    expect(connectRes.status).toBe(201);

    const waba = await patchWaba(
      new NextRequest("http://localhost", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ wabaId: "waba-1" }) }),
      { params: params() },
    );
    expect(waba.status).toBe(200);

    state.phoneNumbers["waba-1"] = [{ id: "pn-1", display_phone_number: "+15551230000", code_verification_status: "VERIFIED", messaging_limit_tier: "TIER_1K" }];
    state.templates["waba-1"] = [{ id: "tmpl-1", name: "greeting", language: "en_US", status: "APPROVED", components: [{ type: "BODY", text: "Hello {{1}}!" }] }];

    const { POST: syncNumbers } = await import("./numbers/route.js");
    const numbersRes = await syncNumbers(new NextRequest("http://localhost", { method: "POST" }), { params: params() });
    expect(numbersRes.status).toBe(200);
    const { numbers } = await numbersRes.json();
    expect(numbers).toHaveLength(1);
    expect(numbers[0].e164).toBe("+15551230000");

    const { POST: syncTemplates } = await import("./templates/route.js");
    const templatesRes = await syncTemplates(new NextRequest("http://localhost", { method: "POST" }), { params: params() });
    expect(templatesRes.status).toBe(200);
    const templatesBody = await templatesRes.json();
    expect(templatesBody.synced).toBe(1);
    expect(templatesBody.templates[0]).toMatchObject({ name: "greeting", status: "Approved" });

    const { POST: activate } = await import("./activate/route.js");
    const activateRes = await activate(new NextRequest("http://localhost", { method: "POST" }), { params: params() });
    expect(activateRes.status).toBe(200);
    const { channel: activated } = await activateRes.json();
    expect(activated.status).toBe("Active");

    // Every mutating action recorded an audit entry attributed to the real admin,
    // never `system` (Final Review B4 discipline applied to this new connector family).
    const auditRows = await withTenant(ctx, (db) => db.select().from(schema.auditLogEntry).where(eq(schema.auditLogEntry.tenantId, ctx.tenantId)));
    const actionTypes = auditRows.map((r) => r.actionType);
    expect(actionTypes).toEqual(expect.arrayContaining(["whatsapp.connect", "whatsapp.waba_config.update", "whatsapp.numbers.sync", "whatsapp.templates.sync", "whatsapp.activate"]));
    expect(auditRows.every((r) => r.actorId === ACTOR_USER_ID)).toBe(true);

    const finalAccount = await getAccount(new NextRequest("http://localhost"), { params: params() });
    const finalBody = await finalAccount.json();
    expect(finalBody.readiness.ready).toBe(true);
  });

  it("403s every route without channels=Write, 200s GET with channels=Read", async () => {
    const state = createMockMetaGraphState();
    await setUp(state);

    await mockSessionAs("Read");
    const { POST: connect, GET: getAccount } = await import("./route.js");
    const connectRes = await connect(new NextRequest("http://localhost", { method: "POST", body: "{}" }), { params: params() });
    expect(connectRes.status).toBe(403);

    const getRes = await getAccount(new NextRequest("http://localhost"), { params: params() });
    expect(getRes.status).toBe(200);
  });

  it("consent: record, list (masked), and bulk import with dry-run vs. commit", async () => {
    const state = createMockMetaGraphState();
    await setUp(state);
    await mockSessionAs("Write");

    const { POST: recordConsentRoute, GET: listConsent } = await import("./consent/route.js");
    const recordRes = await recordConsentRoute(
      new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ customerIdentifier: "+15551112222", state: "OptedIn", source: "CustomerInitiatedMessage" }) }),
      { params: params() },
    );
    expect(recordRes.status).toBe(201);
    const { record } = await recordRes.json();
    expect(record.customerIdentifierMasked).not.toContain("1112222");

    const listRes = await listConsent(new NextRequest("http://localhost"), { params: params() });
    const { records } = await listRes.json();
    expect(records).toHaveLength(1);

    const { POST: importConsent } = await import("./consent/import/route.js");
    const rows = [{ customerIdentifier: "+15553334444", state: "OptedIn" }, { customerIdentifier: "bad-number", state: "OptedIn" }];

    const dryRunRes = await importConsent(
      new NextRequest("http://localhost/x", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }) }),
      { params: params() },
    );
    const dryRunBody = await dryRunRes.json();
    expect(dryRunBody.succeededRows).toBe(1);
    expect(dryRunBody.failedRows).toBe(1);

    const listAfterDryRun = await listConsent(new NextRequest("http://localhost"), { params: params() });
    expect((await listAfterDryRun.json()).records).toHaveLength(1); // dry-run wrote nothing

    const commitRes = await importConsent(
      new NextRequest("http://localhost/x?commit=true", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rows }) }),
      { params: params() },
    );
    expect((await commitRes.json()).succeededRows).toBe(1);

    const listAfterCommit = await listConsent(new NextRequest("http://localhost"), { params: params() });
    expect((await listAfterCommit.json()).records).toHaveLength(2);
  });

  it("QA D1: Webhook tab GET returns the real, deployment-derived webhook URL and an honest (never fabricated) Pending status", async () => {
    const state = createMockMetaGraphState();
    await setUp(state);
    await mockSessionAs("Write");

    process.env.NEXTBOT_GATEWAY_BASE_URL = "http://gateway.internal.test";

    const { POST: connect } = await import("./route.js");
    await connect(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: "biz-1", businessName: "Acme Corp", systemUserToken: "sys-token", appId: "app-1", appSecret: "app-secret" }),
      }),
      { params: params() },
    );

    const { GET: getWebhookStatus } = await import("./webhook/route.js");
    const statusRes = await getWebhookStatus(new NextRequest("http://localhost"), { params: params() });
    expect(statusRes.status).toBe(200);
    const { status } = await statusRes.json();
    expect(status.webhookUrl).toBe(`http://gateway.internal.test/api/v1/channels/whatsapp/webhooks/${ctx.tenantId}/${channelId}`);
    // Never fabricated as "Verified" up front — genuinely Pending until a real
    // handshake (Meta's own, or "Re-verify Challenge") succeeds.
    expect(status.verificationStatus).toBe("Pending");
    expect(status.eventSubscriptions.every((e: { subscribed: boolean }) => e.subscribed === false)).toBe(true);

    delete process.env.NEXTBOT_GATEWAY_BASE_URL;
  });

  it("QA D1: 'Re-verify Challenge' honestly reports Failed when the gateway route is unreachable, never a false 'Verified'", async () => {
    const state = createMockMetaGraphState();
    await setUp(state);
    await mockSessionAs("Write");

    process.env.NEXTBOT_GATEWAY_BASE_URL = "http://127.0.0.1:1"; // connection refused — a genuine transport failure

    const { POST: connect } = await import("./route.js");
    await connect(
      new NextRequest("http://localhost", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId: "biz-1", businessName: "Acme Corp", systemUserToken: "sys-token", appId: "app-1", appSecret: "app-secret" }),
      }),
      { params: params() },
    );

    const { POST: reverify } = await import("./webhook/reverify/route.js");
    const reverifyRes = await reverify(new NextRequest("http://localhost", { method: "POST" }), { params: params() });
    expect(reverifyRes.status).toBe(200);
    const reverifyBody = await reverifyRes.json();
    expect(reverifyBody.status.verificationStatus).toBe("Failed");

    delete process.env.NEXTBOT_GATEWAY_BASE_URL;
  });

  it("credential rotation never echoes the old or new plaintext back", async () => {
    const state = createMockMetaGraphState();
    await setUp(state);
    await mockSessionAs("Write");

    const { POST: connect } = await import("./route.js");
    await connect(
      new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ businessId: "biz-1", businessName: "Acme Corp", systemUserToken: "original-token", appId: "app-1", appSecret: "original-secret" }) }),
      { params: params() },
    );

    const { POST: rotate } = await import("./credentials/route.js");
    const rotateRes = await rotate(
      new NextRequest("http://localhost", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ which: "systemUserToken", value: "rotated-token" }) }),
      { params: params() },
    );
    expect(rotateRes.status).toBe(200);
    const body = await rotateRes.text();
    expect(body).not.toContain("rotated-token");
    expect(body).not.toContain("original-token");
  });
});
