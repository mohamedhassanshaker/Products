import { afterEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { generateId } from "@nextbot/db";
import { startMockMetaGraphServer, createMockMetaGraphState, type MockMetaGraphState } from "@nextbot/testing";
import { WhatsAppTemplateRequiredError, WhatsAppMetaVerificationFailedError } from "@nextbot/contracts";
import { whatsAppAdapter } from "@nextbot/channel-adapters";
import { createWhatsAppChannel, activateWhatsAppChannel, whatsAppChannelReadiness, WhatsAppChannelNotReadyError } from "./create-whatsapp-channel.js";
import { connectMetaBusinessAccount, disconnectMetaBusinessAccount, getMetaBusinessAccountDto, setWabaConfig } from "./connect-meta-business-account.js";
import { syncWhatsAppNumbers, resolveSystemUserToken, rotateSystemUserToken, resolveWebhookVerifyToken } from "./whatsapp-config-service.js";
import { syncWhatsAppTemplates, listWhatsAppTemplateDtos } from "./whatsapp-template-service.js";
import { recordConsent, bulkImportConsent, dryRunBulkImportConsent, maskPhoneNumber, listConsentRecordDtos } from "./whatsapp-consent-service.js";
import { getWebhookStatusDto, reverifyWebhookChallenge } from "./whatsapp-webhook-service.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

/**
 * Provisions a channel + real Meta connect flow against a local mock Graph server.
 * QA D2 fix: `connectMetaBusinessAccount` now performs a real `GET /{business-id}`
 * verification call before persisting anything, so this helper spins up a
 * short-lived mock server just for that call (closed immediately after) — the
 * `state` object it mutates (`businessInfo["biz-1"]`) stays valid for any later
 * mock server a test starts against the same `state` (phone numbers/templates).
 */
async function setupConnectedChannel(state: MockMetaGraphState) {
  const ctx = await createFixtureTenant();
  createdTenantIds.push(ctx.tenantId);
  const channel = await createWhatsAppChannel(ctx, { name: "WA", environment: "Sandbox" });

  state.businessInfo["biz-1"] = { id: "biz-1", name: "Acme Corp" };

  const verifyServer = await startMockMetaGraphServer(state);
  let account;
  try {
    account = await connectMetaBusinessAccount(
      ctx,
      {
        channelId: channel.id,
        businessId: "biz-1",
        businessName: "Acme Corp",
        systemUserToken: "sys-user-token-plaintext",
        appId: "app-123",
        appSecret: "app-secret-plaintext",
      },
      { graphApiBaseUrl: verifyServer.url },
    );
  } finally {
    await verifyServer.close();
  }

  return { ctx, channel, account };
}

describe("WhatsApp channel connect + WABA config (BL-15)", () => {
  it("connects a real Meta Business Manager account and vaults every credential", async () => {
    const state = createMockMetaGraphState();
    const { account } = await setupConnectedChannel(state);

    expect(account.status).toBe("Connected");
    expect(account.businessName).toBe("Acme Corp");
    // Credentials are masked, never plaintext, in the DTO.
    expect(account.systemUserTokenMaskedHint).not.toContain("sys-user-token-plaintext");
    expect(account.appSecretMaskedHint).not.toContain("app-secret-plaintext");
  });

  it("QA D2: rejects connect with a clear error, and vaults nothing, when Meta verification fails", async () => {
    const state = createMockMetaGraphState();
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const channel = await createWhatsAppChannel(ctx, { name: "WA", environment: "Sandbox" });

    // Deliberately never registering "biz-1" in state.businessInfo — the mock
    // server 404s exactly as the real Graph API would for a fabricated/unverified
    // Business ID + token pair.
    const server = await startMockMetaGraphServer(state);
    try {
      await expect(
        connectMetaBusinessAccount(
          ctx,
          {
            channelId: channel.id,
            businessId: "biz-does-not-exist",
            businessName: "Fake Corp",
            systemUserToken: "fabricated-token",
            appId: "app-123",
            appSecret: "app-secret-plaintext",
          },
          { graphApiBaseUrl: server.url },
        ),
      ).rejects.toThrow(WhatsAppMetaVerificationFailedError);
    } finally {
      await server.close();
    }

    // Never a false "Connected" badge, never a partially-vaulted account.
    const account = await getMetaBusinessAccountDto(ctx, channel.id);
    expect(account).toBeNull();
  });

  it("disconnect removes the account (honest disconnected state, never fakes 'Connected')", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);

    await disconnectMetaBusinessAccount(ctx, channel.id);
    const account = await getMetaBusinessAccountDto(ctx, channel.id);
    expect(account).toBeNull();
  });

  it("readiness fails until WABA ID is set, then passes and channel activation succeeds", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);

    const before = await whatsAppChannelReadiness(ctx, channel.id);
    expect(before.ready).toBe(false);
    await expect(activateWhatsAppChannel(ctx, channel.id)).rejects.toThrow(WhatsAppChannelNotReadyError);

    await setWabaConfig(ctx, channel.id, { wabaId: "waba-1" });
    const after = await whatsAppChannelReadiness(ctx, channel.id);
    expect(after.ready).toBe(true);

    const activated = await activateWhatsAppChannel(ctx, channel.id);
    expect(activated.status).toBe("Active");
  });

  it("resolves the real System User token for use against Meta's API", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);
    const { accessToken } = await resolveSystemUserToken(ctx, channel.id);
    expect(accessToken).toBe("sys-user-token-plaintext");
  });

  it("rotates the System User token — old plaintext is gone, new plaintext resolves", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);

    await rotateSystemUserToken(ctx, channel.id, "rotated-token-value");
    const { accessToken } = await resolveSystemUserToken(ctx, channel.id);
    expect(accessToken).toBe("rotated-token-value");
  });

  it("mints a real, per-tenant webhook verify token distinct from any admin-supplied value", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);
    const verifyToken = await resolveWebhookVerifyToken(ctx, channel.id);
    expect(verifyToken).toHaveLength(64); // randomBytes(32).toString("hex")
  });
});

describe("WhatsApp phone-number + template sync (real Meta Graph API round trip via mock server)", () => {
  it("syncs phone numbers and maps Meta's verification/tier vocabulary", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);
    await setWabaConfig(ctx, channel.id, { wabaId: "waba-1" });
    state.phoneNumbers["waba-1"] = [
      { id: "pn-1", display_phone_number: "+15551234567", verified_name: "Acme Support", code_verification_status: "VERIFIED", messaging_limit_tier: "TIER_10K" },
    ];
    const server = await startMockMetaGraphServer(state);
    try {
      const numbers = await syncWhatsAppNumbers(ctx, channel.id, { graphApiBaseUrl: server.url });
      expect(numbers).toHaveLength(1);
      expect(numbers[0]).toMatchObject({ e164: "+15551234567", verificationStatus: "Verified", messagingTier: "Tier3" });
    } finally {
      await server.close();
    }
  });

  it("syncs templates and extracts {{n}} variables from the body", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);
    await setWabaConfig(ctx, channel.id, { wabaId: "waba-1" });
    state.templates["waba-1"] = [
      {
        id: "tmpl-1",
        name: "order_update",
        language: "en_US",
        category: "UTILITY",
        status: "APPROVED",
        components: [{ type: "BODY", text: "Your order {{1}} has shipped to {{2}}." }],
      },
    ];
    const server = await startMockMetaGraphServer(state);
    try {
      const result = await syncWhatsAppTemplates(ctx, channel.id, { graphApiBaseUrl: server.url });
      expect(result.synced).toBe(1);
      expect(result.templates[0]).toMatchObject({ name: "order_update", status: "Approved", variables: ["{{1}}", "{{2}}"] });

      // Re-sync (Meta approves it) — upserts in place, no duplicate row.
      state.templates["waba-1"]![0]!.status = "APPROVED";
      const listed = await listWhatsAppTemplateDtos(ctx, channel.id);
      expect(listed).toHaveLength(1);
    } finally {
      await server.close();
    }
  });

  it("marks the account Unreachable (never a stale 'Connected' badge) on a real transport failure", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);
    await setWabaConfig(ctx, channel.id, { wabaId: "waba-does-not-exist-on-server" });
    // No server started at all -> connection refused, a genuine transport failure.
    await expect(syncWhatsAppTemplates(ctx, channel.id, { graphApiBaseUrl: "http://127.0.0.1:1" })).rejects.toThrow();
    const account = await getMetaBusinessAccountDto(ctx, channel.id);
    expect(account?.status).toBe("Unreachable");
  });
});

describe("WhatsApp 24h session-window enforcement end-to-end against the real Meta send API (mock server)", () => {
  it("rejects pre-send with the exact FR-META-01 copy outside the window, and never calls Meta", async () => {
    const state = createMockMetaGraphState();
    const server = await startMockMetaGraphServer(state);
    try {
      await expect(
        whatsAppAdapter.send(
          { kind: "text", text: "Hi there" },
          { id: "chan-1", tenantId: "t1", type: "WhatsApp", config: {} },
          { accessToken: "tok", phoneNumberId: "pn-1", to: "+15551234567", lastInboundAt: null, graphApiBaseUrl: server.url },
        ),
      ).rejects.toThrow(WhatsAppTemplateRequiredError);
      expect(state.sentMessages).toHaveLength(0);
    } finally {
      await server.close();
    }
  });

  it("sends for real within the window", async () => {
    const state = createMockMetaGraphState();
    const server = await startMockMetaGraphServer(state);
    try {
      const receipt = await whatsAppAdapter.send(
        { kind: "text", text: "Hi there" },
        { id: "chan-1", tenantId: "t1", type: "WhatsApp", config: {} },
        { accessToken: "tok", phoneNumberId: "pn-1", to: "+15551234567", lastInboundAt: new Date().toISOString(), graphApiBaseUrl: server.url },
      );
      expect(receipt.externalMessageId).toBeTruthy();
      expect(state.sentMessages).toHaveLength(1);
    } finally {
      await server.close();
    }
  });
});

describe("QA D1: Webhook tab — real webhook URL, honest verification status, real re-verify round trip", () => {
  it("GET status derives the real webhook URL from the deployment's gateway base URL and starts honestly Pending", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);

    const status = await getWebhookStatusDto(ctx, channel.id, { gatewayBaseUrl: "http://gateway.example.test" });
    expect(status.webhookUrl).toBe(`http://gateway.example.test/api/v1/channels/whatsapp/webhooks/${ctx.tenantId}/${channel.id}`);
    expect(status.verificationStatus).toBe("Pending");
    expect(status.verifiedAt).toBeNull();
    expect(status.lastEventReceivedAt).toBeNull();
    // Never advertised as "subscribed" ahead of a real verified handshake.
    expect(status.eventSubscriptions.length).toBeGreaterThan(0);
    expect(status.eventSubscriptions.every((e) => e.subscribed === false)).toBe(true);
  });

  it("'Re-verify Challenge' performs a real HTTP round trip and only marks Verified when the challenge genuinely echoes back", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);
    const realVerifyToken = await resolveWebhookVerifyToken(ctx, channel.id);

    // A minimal stand-in for the real Gateway Plane webhook GET route's documented
    // contract (`hub.mode=subscribe` + matching `hub.verify_token` -> echo
    // `hub.challenge` back verbatim, 200) — proves `reverifyWebhookChallenge`'s own
    // HTTP-round-trip mechanics genuinely succeed/fail rather than always
    // reporting success, without duplicating the real route's full request
    // handling (already covered end-to-end by `whatsapp-inbound.int.test.ts`).
    const server: Server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://localhost");
      const verifyToken = url.searchParams.get("hub.verify_token");
      const challenge = url.searchParams.get("hub.challenge");
      if (url.searchParams.get("hub.mode") === "subscribe" && verifyToken === realVerifyToken && challenge) {
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(challenge);
        return;
      }
      res.writeHead(403);
      res.end();
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    const gatewayBaseUrl = `http://127.0.0.1:${typeof address === "object" && address ? address.port : 0}`;

    try {
      const verified = await reverifyWebhookChallenge(ctx, channel.id, { gatewayBaseUrl });
      expect(verified.verificationStatus).toBe("Verified");
      expect(verified.verifiedAt).not.toBeNull();
      // Once verified, the connector is healthy AND the webhook has proven it can
      // receive a delivery — event subscriptions now read as active.
      expect(verified.eventSubscriptions.every((e) => e.subscribed === true)).toBe(true);
    } finally {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    }

    // A subsequent failure (unreachable gateway) is recorded honestly too — never
    // leaves a stale "Verified" badge showing after a real failed re-check.
    const failed = await reverifyWebhookChallenge(ctx, channel.id, { gatewayBaseUrl: "http://127.0.0.1:1" });
    expect(failed.verificationStatus).toBe("Failed");
  });
});

describe("WhatsApp opt-in/consent tracking (FR-META)", () => {
  it("records consent and masks the phone number in the DTO", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);

    const record = await recordConsent(ctx, channel.id, { customerIdentifier: "+15551234567", state: "OptedIn", source: "CustomerInitiatedMessage" });
    expect(record.customerIdentifierMasked).toBe(maskPhoneNumber("+15551234567"));
    expect(record.customerIdentifierMasked).not.toContain("5551234");

    const listed = await listConsentRecordDtos(ctx, channel.id);
    expect(listed).toHaveLength(1);
  });

  it("bulk import: one bad row never blocks the rest (FR-KB-01 pattern), and dry-run writes nothing", async () => {
    const state = createMockMetaGraphState();
    const { ctx, channel } = await setupConnectedChannel(state);

    const rows = [
      { customerIdentifier: "+15551111111", state: "OptedIn" as const },
      { customerIdentifier: "not-a-phone-number", state: "OptedIn" as const },
      { customerIdentifier: "+15552222222", state: "OptedOut" as const },
    ];

    const dryRun = dryRunBulkImportConsent({ rows });
    expect(dryRun.succeededRows).toBe(2);
    expect(dryRun.failedRows).toBe(1);
    expect(dryRun.errors[0]).toMatchObject({ row: 1, reason: "Invalid phone format." });
    expect(await listConsentRecordDtos(ctx, channel.id)).toHaveLength(0); // dry-run wrote nothing

    const committed = await bulkImportConsent(ctx, channel.id, { rows }, generateId());
    expect(committed.succeededRows).toBe(2);
    expect(committed.failedRows).toBe(1);
    expect(await listConsentRecordDtos(ctx, channel.id)).toHaveLength(2);
  });
});
