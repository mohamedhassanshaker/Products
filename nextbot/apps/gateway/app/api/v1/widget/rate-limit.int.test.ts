import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import Redis from "ioredis";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createWebWidgetChannel } from "@nextbot/channels";
import { resolveTenantById } from "@nextbot/tenancy";
import { POST as createSession } from "./sessions/route.js";

/**
 * BE2 (QA fix pass) — real Redis, real concurrency, the exact resource-exhaustion
 * repro QA verified exploitable pre-fix ("100/100 concurrent unauthenticated
 * session-creates succeeded instantly"). A distinct, spoofed `x-forwarded-for` IP
 * (not shared with `widget-flow.int.test.ts`'s un-headered "unknown" bucket, and
 * not reused by any other test file) keeps this test's rate-limit counter isolated
 * from other integration tests hitting the same real Redis instance.
 */
const TEST_IP = "203.0.113.77";
const RATE_LIMIT_KEY = `nextbot:ratelimit:widget-session:${TEST_IP}`;

const redis = new Redis(process.env.NEXTBOT_REDIS_TEST_URL ?? "redis://localhost:56379");

async function clearRateLimitKey(): Promise<void> {
  await redis.del(RATE_LIMIT_KEY);
}

const createdTenantIds: string[] = [];

describe("apps/gateway widget session-create rate limiting (BE2, real Redis)", () => {
  beforeEach(async () => {
    process.env.NEXTBOT_WIDGET_SESSION_SECRET = "a-sufficiently-long-test-widget-secret-1234";
    await clearRateLimitKey();
  });
  afterAll(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
    await clearRateLimitKey();
    await redis.quit();
  });

  it("returns 429 with Retry-After once a single IP exceeds the per-minute session-create ceiling", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Rate Limit Widget", environment: "Sandbox" });
    const resolved = await resolveTenantById(tenant.tenantId);

    const makeRequest = () =>
      createSession(
        new NextRequest("http://localhost/api/v1/widget/sessions", {
          method: "POST",
          body: JSON.stringify({ tenantSlug: resolved!.slug, channelPublicKey: channel.publicKey }),
          headers: { "content-type": "application/json", "x-forwarded-for": TEST_IP },
        }),
      );

    // The route's own SESSION_CREATE_LIMIT is 20/60s — exhaust it first.
    const withinLimit = await Promise.all(Array.from({ length: 20 }, () => makeRequest()));
    expect(withinLimit.every((res) => res.status === 201)).toBe(true);

    const oneTooMany = await makeRequest();
    expect(oneTooMany.status).toBe(429);
    expect(oneTooMany.headers.get("retry-after")).toBeTruthy();
  });

  it("does not rate-limit a different IP sharing the same tenant/channel", async () => {
    const tenant = await createFixtureTenant();
    createdTenantIds.push(tenant.tenantId);
    const channel = await createWebWidgetChannel(tenant, { name: "Rate Limit Widget 2", environment: "Sandbox" });
    const resolved = await resolveTenantById(tenant.tenantId);

    await redis.del(`nextbot:ratelimit:widget-session:203.0.113.78`);
    const res = await createSession(
      new NextRequest("http://localhost/api/v1/widget/sessions", {
        method: "POST",
        body: JSON.stringify({ tenantSlug: resolved!.slug, channelPublicKey: channel.publicKey }),
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.78" },
      }),
    );
    expect(res.status).toBe(201);
    await redis.del(`nextbot:ratelimit:widget-session:203.0.113.78`);
  });
});
