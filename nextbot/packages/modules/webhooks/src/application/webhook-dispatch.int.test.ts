import { createServer, type Server } from "node:http";
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { updateTenantStatus } from "@nextbot/tenancy";
import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import { computeHmacSha256Hex } from "@nextbot/agent-platform";
import { KmsEnvelopeSecretsProvider } from "@nextbot/secrets";
import { syncAuditFromEventsForTenant } from "@nextbot/audit";
import type { WebhookEventCategoryValue } from "@nextbot/contracts";
import { eq } from "drizzle-orm";
import { getSigningSecretPlaintext } from "./webhook-subscription-service.js";
import { insertCredential } from "../infrastructure/credential-repository.js";
import { createWebhookSubscription, getWebhookSubscription, type WebhookSubscriptionRow } from "../infrastructure/webhook-subscription-repository.js";
import { listDeliveriesForSubscription } from "../infrastructure/webhook-delivery-repository.js";
import { dispatchWebhooksForTenant, dispatchWebhooksAcrossAllTenants } from "./webhook-dispatch-service.js";

/**
 * `subscribeToWebhooks` rightly rejects a non-`https://` target URL (real
 * production behavior, independently unit-tested by `domain/url-validation.test.ts`)
 * — but this in-process capturing server is plain `http://127.0.0.1` (no real cert
 * authority to mint an https one against in a test process). This helper reproduces
 * `subscribeToWebhooks`'s own vaulting steps EXACTLY (same `insertCredential` call,
 * same envelope-encryption provider), only skipping the https-only check, so this
 * file can test the dispatch/HMAC/retry mechanism itself against a real local
 * receiver without conflating it with the (separately, already-proven) URL
 * validation rule.
 */
async function createTestSubscriptionAgainstUrl(
  ctx: TenantContext,
  targetUrl: string,
  eventCategories: WebhookEventCategoryValue[],
): Promise<WebhookSubscriptionRow> {
  const signingSecretPlaintext = randomBytes(32).toString("hex");
  const credentialId = crypto.randomUUID();
  const encrypted = await new KmsEnvelopeSecretsProvider().put(signingSecretPlaintext, { tenantId: ctx.tenantId, kind: "webhook-signing-secret", id: credentialId });
  await insertCredential(ctx, {
    id: credentialId,
    label: `Webhook signing secret (${targetUrl})`,
    type: "WebhookSecret",
    vaultRef: encrypted.vaultRef,
    ciphertext: encrypted.ciphertext,
    dekRef: encrypted.dekRef,
    maskedHint: encrypted.maskedHint,
  });
  return createWebhookSubscription(ctx, { targetUrl, eventCategories, signingSecretCredentialId: credentialId, createdByUserId: null });
}

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — the plan doc's own exit
 * gate for this sub-phase: real HMAC signature verification (accepted for a genuine
 * signature, rejected for a tampered one), real retry-with-backoff (never silently
 * dropped after one failure), and real proof that this dispatcher's progress is
 * independent of `@nextbot/audit`'s `domain_event.processed` cursor.
 */

interface CapturedRequest {
  body: string;
  signatureHeader: string | null;
}

async function startCapturingServer(responder: () => number): Promise<{ url: string; requests: CapturedRequest[]; close: () => Promise<void> }> {
  const requests: CapturedRequest[] = [];
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      requests.push({ body, signatureHeader: (req.headers["x-nextbot-signature"] as string | undefined) ?? null });
      const status = responder();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: status < 300 }));
    });
  });
  const url = await new Promise<string>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  return {
    url,
    requests,
    close: () => new Promise((resolve, reject) => server.close((err) => (err ? reject(err) : resolve()))),
  };
}

async function insertDomainEvent(ctx: TenantContext, type: string, payload: Record<string, unknown>): Promise<string> {
  const id = generateId();
  await withTenant(ctx, (db: TenantScopedClient) => db.insert(schema.domainEvent).values({ id, tenantId: ctx.tenantId, type, payload }));
  return id;
}

async function setNextAttemptToPast(ctx: TenantContext, subscriptionId: string): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.update(schema.webhookDelivery).set({ nextAttemptAt: new Date(Date.now() - 1000) }).where(eq(schema.webhookDelivery.subscriptionId, subscriptionId)),
  );
}

describe("webhook dispatch — HMAC signing, retry/backoff, and domain_event non-interference (real Postgres, real HTTP)", () => {
  const createdTenantIds: string[] = [];
  const serversToClose: Array<() => Promise<void>> = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    for (const close of serversToClose.splice(0)) await close();
  });

  async function tenantFixture(): Promise<TenantContext> {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    return ctx;
  }

  it("signs the payload with a real HMAC-SHA256 an independent computation accepts, and a tampered secret would NOT produce the same signature", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const server = await startCapturingServer(() => 200);
    const url = server.url;
    serversToClose.push(server.close);

    const subscription = await createTestSubscriptionAgainstUrl(ctx, url, ["EscalationCreated"]);
    await insertDomainEvent(ctx, "escalations.escalation_created", { escalationId: "esc-1", conversationId: "conv-1", queueId: "q-1", reason: "LowConfidence" });

    const result = await dispatchWebhooksForTenant(ctx);
    expect(result.attempted).toBe(1);
    expect(result.delivered).toBe(1);
    expect(server.requests).toHaveLength(1);

    const subscriptionRow = (await getWebhookSubscription(ctx, subscription.id))!;
    const realSecret = await getSigningSecretPlaintext(ctx, subscriptionRow);
    const expectedSignature = `sha256=${computeHmacSha256Hex(realSecret, server.requests[0]!.body)}`;
    expect(server.requests[0]!.signatureHeader).toBe(expectedSignature);

    // A signature computed with the WRONG secret must NOT match — proving the
    // captured signature is genuinely bound to this subscription's own real secret,
    // not merely present/well-formed.
    const wrongSignature = `sha256=${computeHmacSha256Hex("a-completely-different-secret", server.requests[0]!.body)}`;
    expect(server.requests[0]!.signatureHeader).not.toBe(wrongSignature);
  });

  it("retries a failing delivery with backoff rather than dropping it after one attempt, then succeeds once the endpoint recovers", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    let responseStatus = 500;
    const server = await startCapturingServer(() => responseStatus);
    const url = server.url;
    serversToClose.push(server.close);

    const subscription = await createTestSubscriptionAgainstUrl(ctx, url, ["EscalationCreated"]);
    await insertDomainEvent(ctx, "escalations.escalation_created", { escalationId: "esc-2", conversationId: "conv-2", queueId: "q-1", reason: "LowConfidence" });

    const first = await dispatchWebhooksForTenant(ctx);
    expect(first.attempted).toBe(1);
    expect(first.delivered).toBe(0);
    expect(server.requests).toHaveLength(1);

    // A second tick BEFORE the backoff delay elapses must NOT re-attempt (this is the
    // "genuinely schedules a delay" half of the property, not just "will retry
    // eventually").
    const tooSoon = await dispatchWebhooksForTenant(ctx);
    expect(tooSoon.attempted).toBe(0);
    expect(server.requests).toHaveLength(1);

    // Force the backoff window to have elapsed (rather than waiting 30 real seconds)
    // and flip the endpoint healthy — the retry must reach the SAME still-Pending
    // logical delivery, not enqueue a duplicate.
    await setNextAttemptToPast(ctx, subscription.id);
    responseStatus = 200;
    const second = await dispatchWebhooksForTenant(ctx);
    expect(second.attempted).toBe(1);
    expect(second.delivered).toBe(1);
    expect(server.requests).toHaveLength(2);

    // Never duplicated: still exactly one enqueued delivery row for this one
    // domain_event, now Success.
    expect(first.enqueued + tooSoon.enqueued + second.enqueued).toBe(1);
  });

  it("this dispatcher's progress is independent of @nextbot/audit's domain_event.processed cursor — audit-sync still finds/processes the SAME row after webhook dispatch has already run", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const server = await startCapturingServer(() => 200);
    const url = server.url;
    serversToClose.push(server.close);

    await createTestSubscriptionAgainstUrl(ctx, url, ["EscalationCreated"]);
    const domainEventId = await insertDomainEvent(ctx, "escalations.escalation_created", {
      escalationId: "esc-3",
      conversationId: "conv-3",
      queueId: "q-1",
      reason: "LowConfidence",
    });

    const dispatchResult = await dispatchWebhooksForTenant(ctx);
    expect(dispatchResult.delivered).toBe(1);

    // The row's `processed` column must be untouched by the webhook dispatcher —
    // audit-sync must still see it as unprocessed and handle it exactly as if
    // webhooks did not exist at all.
    const rowBeforeSync = await withTenant(ctx, (db: TenantScopedClient) => db.select({ processed: schema.domainEvent.processed }).from(schema.domainEvent).where(eq(schema.domainEvent.id, domainEventId)));
    expect(rowBeforeSync[0]?.processed).toBe(false);

    const syncResult = await syncAuditFromEventsForTenant(ctx);
    expect(syncResult.synced).toBe(1);

    const rowAfterSync = await withTenant(ctx, (db: TenantScopedClient) => db.select({ processed: schema.domainEvent.processed }).from(schema.domainEvent).where(eq(schema.domainEvent.id, domainEventId)));
    expect(rowAfterSync[0]?.processed).toBe(true);

    // And, symmetrically, audit-sync marking the row `processed = true` must not
    // affect a LATER webhook re-dispatch tick's own view of already-delivered work —
    // there is nothing left to attempt (already Success), proven by zero further
    // enqueues/attempts.
    const afterAuditSync = await dispatchWebhooksForTenant(ctx);
    expect(afterAuditSync.enqueued).toBe(0);
    expect(afterAuditSync.attempted).toBe(0);
  });

  it("a network-level fetch failure (not merely a non-2xx response) is caught and scheduled for retry the same way, never thrown out of dispatchWebhooksForTenant", async () => {
    const ctx = await tenantFixture();
    const subscription = await createTestSubscriptionAgainstUrl(ctx, "https://unused.example.invalid", ["EscalationCreated"]);
    await insertDomainEvent(ctx, "escalations.escalation_created", { escalationId: "esc-network", conversationId: "conv-network", queueId: "q-1", reason: "LowConfidence" });

    const throwingFetch = (async () => {
      throw new Error("simulated DNS/network failure");
    }) as unknown as typeof fetch;

    const result = await dispatchWebhooksForTenant(ctx, throwingFetch);
    expect(result.attempted).toBe(1);
    expect(result.delivered).toBe(0);

    const deliveries = await listDeliveriesForSubscription(ctx, subscription.id);
    expect(deliveries[0]?.status).toBe("Failed");
    expect(deliveries[0]?.lastErrorMessage).toContain("simulated DNS/network failure");
  });

  it("a delivery whose source domain_event no longer exists is marked Exhausted immediately, never retried forever", async () => {
    const ctx = await tenantFixture();
    const server = await startCapturingServer(() => 200);
    serversToClose.push(server.close);
    const subscription = await createTestSubscriptionAgainstUrl(ctx, server.url, ["EscalationCreated"]);

    // Directly insert a delivery row pointing at a domain_event id that was never
    // created — the deliberate fault-injection this class of "should never really
    // happen" defensive branch needs, since `domain_event` has no purge job in
    // production.
    await withTenant(ctx, (db: TenantScopedClient) =>
      db.insert(schema.webhookDelivery).values({
        id: generateId(),
        tenantId: ctx.tenantId,
        subscriptionId: subscription.id,
        domainEventId: generateId(),
        eventCategory: "EscalationCreated",
        status: "Pending",
      }),
    );

    const result = await dispatchWebhooksForTenant(ctx);
    expect(result.attempted).toBe(1);
    expect(result.delivered).toBe(0);
    expect(server.requests).toHaveLength(0); // never even attempts an HTTP call

    const deliveries = await listDeliveriesForSubscription(ctx, subscription.id);
    expect(deliveries[0]?.status).toBe("Exhausted");
  });

  it("dispatchWebhooksAcrossAllTenants sweeps every active tenant, aggregating real per-tenant results", async () => {
    const ctxA = await tenantFixture();
    const ctxB = await tenantFixture();
    // `createFixtureTenant()` defaults `status = 'Trial'` (this schema's own real
    // default) — `listActiveTenantContexts()` (the sweep's own tenant source) only
    // ever selects `status = 'Active'` rows, so both fixtures must be activated for
    // real before this cross-tenant sweep can see them.
    await updateTenantStatus(ctxA.tenantId, "Active");
    await updateTenantStatus(ctxB.tenantId, "Active");
    const serverA = await startCapturingServer(() => 200);
    const serverB = await startCapturingServer(() => 200);
    serversToClose.push(serverA.close, serverB.close);

    await createTestSubscriptionAgainstUrl(ctxA, serverA.url, ["EscalationCreated"]);
    await createTestSubscriptionAgainstUrl(ctxB, serverB.url, ["EscalationCreated"]);
    await insertDomainEvent(ctxA, "escalations.escalation_created", { escalationId: "esc-a", conversationId: "conv-a", queueId: "q-1", reason: "LowConfidence" });
    await insertDomainEvent(ctxB, "escalations.escalation_created", { escalationId: "esc-b", conversationId: "conv-b", queueId: "q-1", reason: "LowConfidence" });

    const result = await dispatchWebhooksAcrossAllTenants();
    expect(result.tenantsChecked).toBeGreaterThanOrEqual(2);
    expect(result.delivered).toBeGreaterThanOrEqual(2);
    expect(serverA.requests.length).toBeGreaterThanOrEqual(1);
    expect(serverB.requests.length).toBeGreaterThanOrEqual(1);
  });
});
