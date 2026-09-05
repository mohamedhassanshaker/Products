import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { generateId } from "@nextbot/db";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { resolveTenantById } from "@nextbot/tenancy";
import { issueSandboxPreviewToken } from "@nextbot/iam";
import { POST as createSession } from "./sessions/route.js";

/**
 * Phase 6 (client-feedback-batch item 9), SECURITY-CRITICAL — verifies the one
 * real auth boundary this phase adds: `POST /api/v1/widget/sessions` (otherwise
 * fully anonymous/pre-auth) must reject a `previewVersionId` override outright
 * unless it's paired with a `previewToken` that independently verifies as a genuine,
 * unexpired Admin Console `agent_platform: Write` authorization for that exact
 * version. Every failure mode below is exercised as a real HTTP request against a
 * real Postgres-backed tenant/channel — not asserted by reading the code.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});
beforeEach(() => {
  process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
  process.env.NEXTBOT_SESSION_SECRET = "a-sufficiently-long-test-session-secret-1234";
});

function jsonRequest(url: string, body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

async function setUpTenantAndChannel() {
  const tenant = await createFixtureTenant();
  createdTenantIds.push(tenant.tenantId);
  const channel = await createWebWidgetChannel(tenant, { name: "Sandbox Preview E2E Widget", environment: "Production" });
  const resolved = await resolveTenantById(tenant.tenantId);
  return { tenant, channel, tenantSlug: resolved!.slug };
}

describe("apps/gateway POST /widget/sessions — sandbox-preview override auth boundary", () => {
  it("REJECTED: an anonymous request setting previewVersionId with no previewToken at all gets 403, not a silent fallback session", async () => {
    const { channel, tenantSlug } = await setUpTenantAndChannel();

    const res = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", {
        tenantSlug,
        channelPublicKey: channel.publicKey,
        previewVersionId: "some-draft-version-id",
      }),
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe("SANDBOX_PREVIEW_INVALID");
  });

  it("REJECTED: a garbage/tampered previewToken gets 403", async () => {
    const { channel, tenantSlug } = await setUpTenantAndChannel();

    const res = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", {
        tenantSlug,
        channelPublicKey: channel.publicKey,
        previewVersionId: "some-draft-version-id",
        previewToken: "this-is-not-a-real-jwt",
      }),
    );

    expect(res.status).toBe(403);
  });

  it("REJECTED: a genuinely valid admin-issued token for a DIFFERENT version id than requested gets 403 (no partial trust)", async () => {
    const { tenant, channel, tenantSlug } = await setUpTenantAndChannel();
    const token = await issueSandboxPreviewToken(tenant.tenantId, "admin-user-1", "version-A");

    const res = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", {
        tenantSlug,
        channelPublicKey: channel.publicKey,
        previewVersionId: "version-B", // requested version does not match the token's versionId
        previewToken: token,
      }),
    );

    expect(res.status).toBe(403);
  });

  it("REJECTED: a genuinely valid admin-issued token for a DIFFERENT tenant gets 403 (no cross-tenant preview)", async () => {
    const { channel, tenantSlug } = await setUpTenantAndChannel();
    const otherTenantToken = await issueSandboxPreviewToken("some-other-tenant-id", "admin-user-1", "version-A");

    const res = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", {
        tenantSlug,
        channelPublicKey: channel.publicKey,
        previewVersionId: "version-A",
        previewToken: otherTenantToken,
      }),
    );

    expect(res.status).toBe(403);
  });

  it("ACCEPTED: a genuinely valid, matching admin-issued token creates a real Sandbox-environment session", async () => {
    const { tenant, channel, tenantSlug } = await setUpTenantAndChannel();
    // A real generated id — `conversation.agent_definition_version_id` is a `uuid`
    // column, unlike the REJECTED cases above which never reach that insert.
    const versionId = generateId();
    const token = await issueSandboxPreviewToken(tenant.tenantId, "admin-user-1", versionId);

    const res = await createSession(
      jsonRequest("http://localhost/api/v1/widget/sessions", {
        tenantSlug,
        channelPublicKey: channel.publicKey,
        previewVersionId: versionId,
        previewToken: token,
      }),
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as { sessionToken: string; conversationId: string };
    expect(body.conversationId).toBeTruthy();
    expect(body.sessionToken).toBeTruthy();
  });

  it("an ordinary session request with no previewVersionId at all is entirely unaffected by this gate", async () => {
    const { channel, tenantSlug } = await setUpTenantAndChannel();

    const res = await createSession(jsonRequest("http://localhost/api/v1/widget/sessions", { tenantSlug, channelPublicKey: channel.publicKey }));

    expect(res.status).toBe(201);
  });
});
