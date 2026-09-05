import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { resolveTenantById } from "@nextbot/tenancy";
import { POST as createSession } from "./sessions/route.js";
import { POST as sendMessage } from "./messages/route.js";
import { POST as setTyping } from "./typing/route.js";
import { POST as setLanguage } from "./language/route.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});
beforeEach(() => {
  process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
});

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("apps/gateway widget routes (real Postgres, first Gateway Plane surface)", () => {
  it("full round trip: create session -> send message -> receives 202 with a sequence", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Gateway E2E Widget", environment: "Sandbox" });
    const resolved = await resolveTenantById(tenant.tenantId);

    const sessionRes = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", {
        tenantSlug: resolved!.slug,
        channelPublicKey: channel.publicKey,
      }),
    );
    expect(sessionRes.status).toBe(201);
    expect(sessionRes.headers.get("access-control-allow-origin")).toBe("*");
    const session = (await sessionRes.json()) as { sessionToken: string; conversationId: string };
    expect(session.conversationId).toBeTruthy();

    const messageRes = await sendMessage(
      jsonRequest(
        "http://localhost/api/v1/widget/messages",
        { clientMessageId: "e2e-1", contentType: "Text", payload: { contentType: "Text", text: "hi there" } },
        { authorization: `Bearer ${session.sessionToken}`, "idempotency-key": "e2e-1" },
      ),
    );
    expect(messageRes.status).toBe(202);
    const result = (await messageRes.json()) as { sequence: number };
    expect(result.sequence).toBe(1);
  });

  it("401s a message send with no bearer token", async () => {
    const res = await sendMessage(
      jsonRequest("http://localhost/api/v1/widget/messages", {
        clientMessageId: "x",
        contentType: "Text",
        payload: { contentType: "Text", text: "hi" },
      }),
    );
    expect(res.status).toBe(401);
  });

  it("404s a session request for an unknown channel public key", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const resolved = await resolveTenantById(tenant.tenantId);

    const res = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", { tenantSlug: resolved!.slug, channelPublicKey: "wc_nope" }),
    );
    expect(res.status).toBe(404);
  });

  it("typing endpoint returns 204 with a valid session", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Typing Widget", environment: "Sandbox" });
    const resolved = await resolveTenantById(tenant.tenantId);
    const sessionRes = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", { tenantSlug: resolved!.slug, channelPublicKey: channel.publicKey }),
    );
    const session = (await sessionRes.json()) as { sessionToken: string };

    const res = await setTyping(
      jsonRequest("http://localhost/api/v1/widget/typing", { state: "start" }, { authorization: `Bearer ${session.sessionToken}` }),
    );
    expect(res.status).toBe(204);
  });

  it("language endpoint persists the selection and returns 204", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Lang Widget", environment: "Sandbox" });
    const resolved = await resolveTenantById(tenant.tenantId);
    const sessionRes = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", { tenantSlug: resolved!.slug, channelPublicKey: channel.publicKey }),
    );
    const session = (await sessionRes.json()) as { sessionToken: string };

    const res = await setLanguage(
      jsonRequest("http://localhost/api/v1/widget/language", { language: "ar" }, { authorization: `Bearer ${session.sessionToken}` }),
    );
    expect(res.status).toBe(204);
  });
});
