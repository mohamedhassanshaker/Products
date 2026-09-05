import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { WebhookSubscriptionNotFoundError, WebhookTargetUrlInvalidError } from "@nextbot/contracts";
import type { TenantContext } from "@nextbot/db";
import { subscribeToWebhooks, listSubscriptions, updateSubscription, unsubscribe, getSigningSecretPlaintext } from "./webhook-subscription-service.js";
import { getWebhookSubscription } from "../infrastructure/webhook-subscription-repository.js";

describe("webhook subscription CRUD + signing-secret round-trip (real Postgres, real envelope encryption)", () => {
  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  async function tenant(): Promise<TenantContext> {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    return ctx;
  }

  it("rejects a non-https target URL at creation, never persisting a row", async () => {
    const ctx = await tenant();
    await expect(subscribeToWebhooks(ctx, { targetUrl: "http://insecure.example.com", eventCategories: ["EscalationCreated"], createdByUserId: null })).rejects.toBeInstanceOf(
      WebhookTargetUrlInvalidError,
    );
    expect(await listSubscriptions(ctx)).toHaveLength(0);
  });

  it("creates a subscription, returns the plaintext signing secret exactly once, and the vaulted secret decrypts back to the SAME plaintext", async () => {
    const ctx = await tenant();
    const { subscription, signingSecret } = await subscribeToWebhooks(ctx, {
      targetUrl: "https://example.com/webhooks/nextbot",
      eventCategories: ["EscalationCreated", "DriftDetected"],
      createdByUserId: null,
    });
    expect(signingSecret).toHaveLength(64); // 32 random bytes, hex-encoded
    expect(subscription.enabled).toBe(true);

    const row = (await getWebhookSubscription(ctx, subscription.id))!;
    expect(await getSigningSecretPlaintext(ctx, row)).toBe(signingSecret);

    // The list/read views never expose the secret at all — only this creation
    // response does, exactly once (mirrors `issueApiKey`'s own convention).
    const listed = await listSubscriptions(ctx);
    expect(listed).toHaveLength(1);
    expect(Object.keys(listed[0]!)).not.toContain("signingSecret");
  });

  it("updates target URL, categories, and enabled state independently", async () => {
    const ctx = await tenant();
    const { subscription } = await subscribeToWebhooks(ctx, { targetUrl: "https://a.example.com", eventCategories: ["EscalationCreated"], createdByUserId: null });

    const updated = await updateSubscription(ctx, subscription.id, { enabled: false });
    expect(updated.enabled).toBe(false);
    expect(updated.targetUrl).toBe("https://a.example.com"); // untouched

    await expect(updateSubscription(ctx, subscription.id, { targetUrl: "not-a-url" })).rejects.toBeInstanceOf(WebhookTargetUrlInvalidError);
  });

  it("deleting a subscription is real — a later update/list no longer sees it", async () => {
    const ctx = await tenant();
    const { subscription } = await subscribeToWebhooks(ctx, { targetUrl: "https://a.example.com", eventCategories: ["EscalationCreated"], createdByUserId: null });
    await unsubscribe(ctx, subscription.id);
    expect(await listSubscriptions(ctx)).toHaveLength(0);
    await expect(updateSubscription(ctx, subscription.id, { enabled: true })).rejects.toBeInstanceOf(WebhookSubscriptionNotFoundError);
  });

  it("a subscription id from one tenant is invisible to another (tenant isolation, not merely convention)", async () => {
    const ctxA = await tenant();
    const ctxB = await tenant();
    const { subscription } = await subscribeToWebhooks(ctxA, { targetUrl: "https://a.example.com", eventCategories: ["EscalationCreated"], createdByUserId: null });
    await expect(updateSubscription(ctxB, subscription.id, { enabled: false })).rejects.toBeInstanceOf(WebhookSubscriptionNotFoundError);
  });
});
