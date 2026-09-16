/**
 * The wave's own hard requirement: a POST with a WRONG/missing `X-Hub-Signature-256`
 * genuinely 403s with the payload never processed, and the SAME body with the CORRECT
 * signature genuinely succeeds — exercised against the REAL route handler
 * (`app/api/webhooks/whatsapp/route.ts`'s real `POST`/`GET` functions, invoked in-process
 * with real `Request` objects, per this project's Next.js route-handler testing convention)
 * and REAL crypto — never a unit test that mocks the HMAC check itself.
 *
 * "Never processed" is proven by a real side effect's absence/presence, not by inspecting
 * the response alone: the replay-guard's Redis key (`public:wa:msg:{messageId}`) is only
 * ever claimed from inside the tenant-bound processing block, which sits textually AFTER the
 * signature check's early return — so its absence after a rejected request is direct
 * evidence the processing block never ran, not an inference from the status code.
 *
 * Requires the real `sqlserver` and `redis` containers, and `sewa`'s seeded WhatsApp channel
 * (`scripts/seed-channels-demo-data.ts`, `phoneNumberId: "shj3-sewa-whatsapp-demo"`).
 */
/**
 * Deliberately imports only from `apps/web/src/...` (never the `redis` package directly):
 * `redis` is a dependency of the `apps/web` workspace package, not of the repo root, and
 * pnpm's strict (non-hoisted) resolution means a root-level test file cannot `import
 * "redis"` directly even though the exact same package resolves fine from any module that
 * physically lives inside `apps/web` (found for real — the first draft of this spec did
 * import it directly and failed to resolve at collection time). Reusing this module's own
 * already-existing `getTenantCache()` and `platform-replay-guard.ts` helpers sidesteps the
 * problem entirely, since Node/Vite resolve a bare specifier relative to the IMPORTING
 * file's own location, not the top-level test file's.
 */
import { randomUUID, createHash, createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runWithTenant } from "../../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { disconnectAllTenantDbs } from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { getTenantCache } from "../../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { seedChannelsAndHandoverHours } from "../../apps/web/src/modules/channels/adapters/outbound/sql/seed-channels-demo-data.js";
import { PrismaConsentRepository } from "../../apps/web/src/modules/channels/adapters/outbound/sql/prisma-consent-repository.js";
import {
  disconnectReplayGuard,
  hasClaimedMessageId,
} from "../../apps/web/src/modules/platform/adapters/outbound/cache/platform-replay-guard.js";
import { getTenantDb } from "../../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";

const SEWA = assertValidSlugShape("sewa");
const TEST_APP_SECRET = "integration-test-app-secret";
const PHONE_NUMBER_ID = "shj3-sewa-whatsapp-demo";
const TEST_WA_ID = "971500000999";

function withSewaTenant<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    {
      tenant: SEWA,
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "identity",
    },
    fn,
  );
}

beforeAll(async () => {
  process.env.SHJ3_WHATSAPP_APP_SECRET = TEST_APP_SECRET;

  await withSewaTenant(async () => {
    const db = getTenantDb();
    const agent = await db.agent.findFirst({ where: { name: "SEWA & Utilities Billing Agent" } });
    const team = await db.team.findFirst({ where: { name: "SEWA Billing" } });
    if (agent && team) {
      await seedChannelsAndHandoverHours({
        boundAgentId: agent.id,
        defaultQueueTeamId: team.id,
        now: new Date(),
      });
    }

    // Pre-record a real opt-in for the test waId so the inbound message path never attempts
    // the fire-and-forget opt-in-notice network call — this spec proves signature
    // enforcement, not the (documented, out-of-network) template-send path.
    const consent = new PrismaConsentRepository();
    // Must match the route's own `subjectHashFor()` (a plain SHA-256 of the waId) exactly,
    // or the route's opt-in check would never find this fixture's consent state.
    const subjectHash = createHash("sha256").update(TEST_WA_ID).digest("hex");
    await consent.appendLedgerEntry({
      subjectKind: "ContactHash",
      citizenIdentityId: null,
      subjectHash,
      channelKey: "WhatsApp",
      purpose: "ProactiveMessaging",
      action: "OptIn",
      evidenceKind: "TestFixture",
      evidenceRef: null,
      occurredAt: new Date(),
      sourceTurnId: null,
      now: new Date(),
    });
  });
});

afterAll(async () => {
  await disconnectAllTenantDbs();
  await disconnectReplayGuard();
});

function bodyFor(messageId: string): string {
  return JSON.stringify({
    entry: [
      {
        changes: [
          {
            value: {
              metadata: { phone_number_id: PHONE_NUMBER_ID },
              messages: [
                {
                  from: TEST_WA_ID,
                  id: messageId,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: "text",
                  text: { body: "What is my bill balance?" },
                },
              ],
            },
          },
        ],
      },
    ],
  });
}

function realSignatureFor(body: string): string {
  return `sha256=${createHmac("sha256", TEST_APP_SECRET).update(body).digest("hex")}`;
}

async function postWebhook(body: string, signature?: string): Promise<Response> {
  // Dynamic import so `process.env.SHJ3_WHATSAPP_APP_SECRET` above is set before the module
  // (and anything it may cache) is first evaluated.
  const { POST } = await import("../../apps/web/src/app/api/webhooks/whatsapp/route.js");
  const headers = new Headers({ "content-type": "application/json" });
  if (signature) headers.set("x-hub-signature-256", signature);
  const request = new Request("https://web.shj3.internal/api/webhooks/whatsapp", {
    method: "POST",
    headers,
    body,
  });
  return POST(request);
}

async function replayKeyExists(messageId: string): Promise<boolean> {
  return hasClaimedMessageId(messageId);
}

async function sessionWindowKeyExists(): Promise<boolean> {
  return withSewaTenant(async () => {
    const ttl = await getTenantCache().ttl(`wa:window:${TEST_WA_ID}`);
    return ttl > 0;
  });
}

describe("POST /api/webhooks/whatsapp — signature enforcement (real crypto, real infra)", () => {
  it("rejects a MISSING signature with 403 and never processes the payload", async () => {
    const messageId = `wamid.test-missing-${randomUUID()}`;
    const response = await postWebhook(bodyFor(messageId));

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(text).toBe("");
    expect(await replayKeyExists(messageId)).toBe(false);
  });

  it("rejects a WRONG signature with 403 and never processes the payload", async () => {
    const messageId = `wamid.test-wrong-${randomUUID()}`;
    const body = bodyFor(messageId);
    const wrongSignature = `sha256=${"0".repeat(64)}`;

    const response = await postWebhook(body, wrongSignature);

    expect(response.status).toBe(403);
    expect(await replayKeyExists(messageId)).toBe(false);
  });

  it("accepts the CORRECT signature over the exact same body and genuinely processes it", async () => {
    const messageId = `wamid.test-correct-${randomUUID()}`;
    const body = bodyFor(messageId);
    const signature = realSignatureFor(body);

    const response = await postWebhook(body, signature);

    expect(response.status).toBe(200);
    // Real side effects that only happen INSIDE the tenant-bound processing block —
    // direct proof the request was actually processed, not merely accepted.
    expect(await replayKeyExists(messageId)).toBe(true);
    expect(await sessionWindowKeyExists()).toBe(true);
  });

  it("acknowledges (200) a replayed message on the second delivery without reprocessing", async () => {
    const messageId = `wamid.test-replay-${randomUUID()}`;
    const body = bodyFor(messageId);
    const signature = realSignatureFor(body);

    const first = await postWebhook(body, signature);
    const second = await postWebhook(body, signature);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await replayKeyExists(messageId)).toBe(true);
  });
});
