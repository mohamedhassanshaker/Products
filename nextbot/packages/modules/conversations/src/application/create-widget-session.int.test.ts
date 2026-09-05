import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateId } from "@nextbot/db";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { WidgetChannelNotFoundError, SandboxPreviewInvalidError } from "@nextbot/contracts";
import { createWidgetSession } from "./create-widget-session.js";
import { verifyWidgetSessionToken } from "./widget-session-token.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});
beforeEach(() => {
  process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
});

describe("createWidgetSession (BL-04 backend slice, real Postgres)", () => {
  it("issues a session token + conversation for a valid tenant slug + channel public key", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Main Widget", environment: "Sandbox" });

    const result = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey });

    expect(result.conversationId).toBeTruthy();
    expect(result.resumeFromSequence).toBe(0);
    const claims = await verifyWidgetSessionToken(result.sessionToken);
    expect(claims.tenantId).toBe(tenant.tenantId);
    expect(claims.channelId).toBe(channel.id);
  });

  it("falls back to the tenant's default language when 'auto'/unset", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Lang Widget", environment: "Sandbox" });

    const result = await createWidgetSession({
      tenantSlug: await tenantSlugOf(tenant.tenantId),
      channelPublicKey: channel.publicKey,
      language: "auto",
    });
    expect(result.channel.languages).toEqual(["en"]);
  });

  it("fails closed with WidgetChannelNotFoundError for an unknown tenant slug", async () => {
    await expect(
      createWidgetSession({ tenantSlug: "does-not-exist-slug", channelPublicKey: "wc_x" }),
    ).rejects.toThrow(WidgetChannelNotFoundError);
  });

  it("resumes the same conversation when a valid resumeSessionToken references it", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Resume Widget", environment: "Sandbox" });
    const slug = await tenantSlugOf(tenant.tenantId);

    const first = await createWidgetSession({ tenantSlug: slug, channelPublicKey: channel.publicKey });
    const second = await createWidgetSession({
      tenantSlug: slug,
      channelPublicKey: channel.publicKey,
      resumeSessionToken: first.sessionToken,
    });

    expect(second.conversationId).toBe(first.conversationId);
  });

  it("silently starts a new conversation when the resumeSessionToken is invalid/expired", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Bad Resume Widget", environment: "Sandbox" });
    const slug = await tenantSlugOf(tenant.tenantId);

    const result = await createWidgetSession({
      tenantSlug: slug,
      channelPublicKey: channel.publicKey,
      resumeSessionToken: "garbage-not-a-jwt",
    });
    expect(result.conversationId).toBeTruthy();
  });

  it("FR-ADM-07: the widget session inherits the tenant's brand profile automatically, with no per-embed override", async () => {
    const { updateBranding } = await import("@nextbot/tenancy");
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Branded Widget", environment: "Sandbox" });

    await updateBranding(tenant.tenantId, {
      branding: {
        primaryColor: "#1B6B4A",
        secondaryColor: "#0E3B28",
        logoLightUrl: "https://example.com/logo-light.svg",
        logoDarkUrl: null,
        faviconUrl: null,
        fontFamily: "Inter",
      },
      whiteLabelEnabled: true,
    });

    const result = await createWidgetSession({ tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey });

    expect(result.channel.config.theme?.primaryColor).toBe("#1B6B4A");
    expect(result.channel.config.theme?.fontFamily).toBe("Inter");
    expect(result.channel.config.theme?.launcherIcon).toBe("https://example.com/logo-light.svg");
    expect(result.channel.hidePoweredBy).toBe(true);
  });

  // Phase 6 (client-feedback-batch item 9) — module-level defense in depth. The real
  // cryptographic verification happens one layer up (`apps/gateway`'s composition
  // root, since this module has no allowed dependency on `@nextbot/iam`), but
  // `createWidgetSession` itself must independently refuse to honor
  // `previewVersionId` if a future caller ever forgets to gate it — these prove that
  // refusal directly against this function, without going through the HTTP layer.
  describe("sandbox-preview override — fails closed at the module boundary too", () => {
    it("REJECTED: previewVersionId with no verifiedPreview argument at all", async () => {
      const tenant = await createFixtureTenant();
      createdTenantIds.push(tenant.tenantId);
      const channel = await createWebWidgetChannel(tenant, { name: "Preview Widget A", environment: "Production" });

      await expect(
        createWidgetSession({
          tenantSlug: await tenantSlugOf(tenant.tenantId),
          channelPublicKey: channel.publicKey,
          previewVersionId: "v1",
        }),
      ).rejects.toThrow(SandboxPreviewInvalidError);
    });

    it("REJECTED: verifiedPreview.versionId doesn't match the requested previewVersionId", async () => {
      const tenant = await createFixtureTenant();
      createdTenantIds.push(tenant.tenantId);
      const channel = await createWebWidgetChannel(tenant, { name: "Preview Widget B", environment: "Production" });

      await expect(
        createWidgetSession(
          { tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey, previewVersionId: "v1" },
          { tenantId: tenant.tenantId, versionId: "v2" },
        ),
      ).rejects.toThrow(SandboxPreviewInvalidError);
    });

    it("REJECTED: verifiedPreview.tenantId doesn't match the resolved tenant", async () => {
      const tenant = await createFixtureTenant();
      createdTenantIds.push(tenant.tenantId);
      const channel = await createWebWidgetChannel(tenant, { name: "Preview Widget C", environment: "Production" });

      await expect(
        createWidgetSession(
          { tenantSlug: await tenantSlugOf(tenant.tenantId), channelPublicKey: channel.publicKey, previewVersionId: "v1" },
          { tenantId: "a-different-tenant-id", versionId: "v1" },
        ),
      ).rejects.toThrow(SandboxPreviewInvalidError);
    });

    it("ACCEPTED: a genuinely matching verifiedPreview creates a Sandbox-environment session tagged with the version id", async () => {
      const tenant = await createFixtureTenant();
      createdTenantIds.push(tenant.tenantId);
      // Deliberately a "Production" channel: the sandbox override forces the
      // *session's* environment to "Sandbox" regardless of the borrowed channel's own
      // configured environment (see create-widget-session.ts's doc).
      const channel = await createWebWidgetChannel(tenant, { name: "Preview Widget D", environment: "Production" });
      const slug = await tenantSlugOf(tenant.tenantId);
      // A real generated id — `conversation.agent_definition_version_id` is a `uuid`
      // column, so it's persisted here (Phase 6 is this column's first real writer).
      const versionId = generateId();

      const result = await createWidgetSession(
        { tenantSlug: slug, channelPublicKey: channel.publicKey, previewVersionId: versionId },
        { tenantId: tenant.tenantId, versionId },
      );

      expect(result.conversationId).toBeTruthy();
      const claims = await verifyWidgetSessionToken(result.sessionToken);
      expect(claims.environment).toBe("Sandbox");
      expect(claims.previewVersionId).toBe(versionId);
    });

    it("a preview session never resumes a prior conversation even if resumeSessionToken is also supplied", async () => {
      const tenant = await createFixtureTenant();
      createdTenantIds.push(tenant.tenantId);
      const channel = await createWebWidgetChannel(tenant, { name: "Preview Widget E", environment: "Production" });
      const slug = await tenantSlugOf(tenant.tenantId);
      const versionId = generateId();

      const first = await createWidgetSession(
        { tenantSlug: slug, channelPublicKey: channel.publicKey, previewVersionId: versionId },
        { tenantId: tenant.tenantId, versionId },
      );
      const second = await createWidgetSession(
        { tenantSlug: slug, channelPublicKey: channel.publicKey, previewVersionId: versionId, resumeSessionToken: first.sessionToken },
        { tenantId: tenant.tenantId, versionId },
      );

      expect(second.conversationId).not.toBe(first.conversationId);
    });
  });
});

async function tenantSlugOf(tenantId: string): Promise<string> {
  const { resolveTenantById } = await import("@nextbot/tenancy");
  const tenant = await resolveTenantById(tenantId);
  return tenant?.slug ?? "";
}
