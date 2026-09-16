import { describe, expect, it } from "vitest";
import { validateConfig } from "../../../../platform/config.js";
import { createMockPaymentGateway, MockPaymentGateway } from "./mock-payment-gateway.js";

/**
 * `MockPaymentGateway`'s own production-boot refusal — B-8's payments
 * analogue of ADR-0006 rule 6, proven test-for-test against
 * `mock-verification-provider.test.ts`'s identical structure. **This is the
 * hard requirement**: the mock adapter must be structurally incapable of
 * booting in Production, not merely documented as such.
 */
const BASE_ENV = {
  SHJ3_ENVIRONMENT: "development",
  SHJ3_SQL_URL: "sqlserver://localhost:1433;database=shj3",
  SHJ3_REDIS_URL: "redis://localhost:6379",
  SHJ3_SESSION_SECRET: "local-dev-session-secret-not-for-production",
  SHJ3_VERIFICATION_ADAPTER: "mock",
  SHJ3_PAYMENT_GATEWAY_ADAPTER: "mock",
  SHJ3_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
};

describe("it cannot be constructed in production", () => {
  it("throws, naming the risk, when constructed with a Production-shaped config", () => {
    const config = validateConfig({
      ...BASE_ENV,
      SHJ3_ENVIRONMENT: "production",
      SHJ3_VERIFICATION_ADAPTER: "uaepass",
      SHJ3_PAYMENT_GATEWAY_ADAPTER: "sharjahpay", // config-level guard needs a real adapter selected to validate at all
      SHJ3_SESSION_SECRET: "a".repeat(48),
    });

    // The object-level guard is the one under test here — it must refuse
    // regardless of what `config.paymentGatewayAdapter` itself says, so a
    // future call site that constructs this adapter directly (bypassing
    // config-driven selection entirely) still cannot reach a production
    // runtime with it.
    const productionShapedConfig = { ...config, environment: "production" as const };
    expect(() =>
      createMockPaymentGateway(productionShapedConfig, { clock: { now: () => new Date() } }),
    ).toThrow(/production/i);
  });

  it("constructs cleanly in every non-production environment", () => {
    const config = validateConfig(BASE_ENV);
    expect(() =>
      createMockPaymentGateway(config, { clock: { now: () => new Date() } }),
    ).not.toThrow();
  });
});

describe("settlement, deterministic", () => {
  it("settles synchronously by default", async () => {
    const gateway = new MockPaymentGateway({ clock: { now: () => new Date() } });
    const intent = await gateway.createIntent(
      {
        amount: { amountMinor: 41_200n, currency: "AED" },
        method: "card",
        reference: "TXN-1",
        description: "SEWA bill",
      },
      { value: "idem-1" },
    );
    expect(intent.outcome.kind).toBe("settled");
  });

  it("is idempotent — the same key returns the same recorded outcome, never a second charge", async () => {
    const gateway = new MockPaymentGateway({ clock: { now: () => new Date() } });
    const request = {
      amount: { amountMinor: 41_200n, currency: "AED" },
      method: "card" as const,
      reference: "TXN-1",
      description: "SEWA bill",
    };
    const first = await gateway.createIntent(request, { value: "idem-1" });
    const second = await gateway.createIntent(request, { value: "idem-1" });
    expect(second.gatewayReference).toBe(first.gatewayReference);
  });

  it("can be driven to a decline for the unhappy-path proof", async () => {
    const gateway = new MockPaymentGateway({ clock: { now: () => new Date() } });
    gateway.rejectNext("card_expired");
    const intent = await gateway.createIntent(
      {
        amount: { amountMinor: 41_200n, currency: "AED" },
        method: "card",
        reference: "TXN-2",
        description: "SEWA bill",
      },
      { value: "idem-2" },
    );
    expect(intent.outcome).toEqual({
      kind: "declined",
      gatewayReference: intent.gatewayReference,
      reason: "card_expired",
    });
  });
});
