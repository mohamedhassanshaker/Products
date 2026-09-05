import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { resolveTenantById } from "@nextbot/tenancy";
import { createWidgetSession } from "./create-widget-session.js";
import { sendWidgetMessage } from "./send-widget-message.js";
import { verifyWidgetSessionToken } from "./widget-session-token.js";
import { replayMessagesSince } from "./stream-widget-events.js";
import type { TenantContext } from "@nextbot/db";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});
beforeEach(() => {
  process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
});

async function setUpSession() {
  const tenant = await createFixtureTenant();
  createdTenantIds.push(tenant.tenantId);
  const channel = await createWebWidgetChannel(tenant, { name: "Msg Widget", environment: "Sandbox" });
  const resolved = await resolveTenantById(tenant.tenantId);
  const session = await createWidgetSession({ tenantSlug: resolved!.slug, channelPublicKey: channel.publicKey });
  const claims = await verifyWidgetSessionToken(session.sessionToken);
  return { tenant, channel, session, claims };
}

describe("sendWidgetMessage (BL-04 backend slice, real Postgres)", () => {
  it("persists the customer message with sequence 1 and a placeholder AI reply with sequence 2", async () => {
    const { claims } = await setUpSession();

    const result = await sendWidgetMessage(claims, {
      clientMessageId: "client-msg-1",
      contentType: "Text",
      payload: { contentType: "Text", text: "Hello" },
    });

    expect(result.sequence).toBe(1);

    const ctx: TenantContext = { tenantId: claims.tenantId, region: claims.region, environment: claims.environment };
    const replay = await replayMessagesSince(ctx, claims.conversationId, 0);
    expect(replay.map((m) => m.sender)).toEqual(["Customer", "AI"]);
    expect(replay.map((m) => m.sequence)).toEqual([1, 2]);
  });

  it("is gap-free and monotonic under concurrent sends", async () => {
    const { claims } = await setUpSession();

    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        sendWidgetMessage(claims, {
          clientMessageId: `concurrent-${i}`,
          contentType: "Text",
          payload: { contentType: "Text", text: `msg ${i}` },
        }),
      ),
    );

    const sequences = results.map((r) => r.sequence).sort((a, b) => a - b);
    // 5 concurrent sends x 2 messages each (customer + AI) = 10 total sequence slots;
    // each result reports the *customer* message's own sequence number.
    expect(new Set(sequences).size).toBe(5);

    const ctx: TenantContext = { tenantId: claims.tenantId, region: claims.region, environment: claims.environment };
    const replay = await replayMessagesSince(ctx, claims.conversationId, 0);
    const allSequences = replay.map((m) => m.sequence).sort((a, b) => a - b);
    expect(allSequences).toEqual(Array.from({ length: 10 }, (_, i) => i + 1));
  });

  it("BE1: 20 truly-concurrent sends with the identical clientMessageId all succeed (no spurious 500) and agree on the same messageId/sequence", async () => {
    const { claims } = await setUpSession();

    // Pre-fix, this reproduced QA's exact finding: only one caller ever wrote a
    // row (data integrity was always fine), but the other 19 callers' plain
    // SELECT-then-INSERT check raced past the SELECT before either had committed,
    // then hit the unique-constraint violation on INSERT as an *uncaught* error —
    // violating the "resending the same clientMessageId is safe" contract this
    // endpoint documents.
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        sendWidgetMessage(claims, {
          clientMessageId: "race-1",
          contentType: "Text",
          payload: { contentType: "Text", text: "Hello" },
        }),
      ),
    );

    const messageIds = new Set(results.map((r) => r.messageId));
    const sequences = new Set(results.map((r) => r.sequence));
    expect(messageIds.size).toBe(1);
    expect(sequences.size).toBe(1);

    const ctx: TenantContext = { tenantId: claims.tenantId, region: claims.region, environment: claims.environment };
    const replay = await replayMessagesSince(ctx, claims.conversationId, 0);
    // Exactly 2 rows (1 customer + 1 AI reply) — the race didn't produce a second
    // customer row or a second AI reply.
    expect(replay).toHaveLength(2);
  });

  it("is idempotent — resending the same clientMessageId does not create a duplicate or a second AI reply", async () => {
    const { claims } = await setUpSession();

    const first = await sendWidgetMessage(claims, {
      clientMessageId: "dup-id",
      contentType: "Text",
      payload: { contentType: "Text", text: "Hello" },
    });
    const second = await sendWidgetMessage(claims, {
      clientMessageId: "dup-id",
      contentType: "Text",
      payload: { contentType: "Text", text: "Hello" },
    });

    expect(second.messageId).toBe(first.messageId);
    expect(second.sequence).toBe(first.sequence);

    const ctx: TenantContext = { tenantId: claims.tenantId, region: claims.region, environment: claims.environment };
    const replay = await replayMessagesSince(ctx, claims.conversationId, 0);
    // Exactly 2 rows (1 customer + 1 AI reply), not 4.
    expect(replay).toHaveLength(2);
  });
});
