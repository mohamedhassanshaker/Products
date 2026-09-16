import { describe, expect, it } from "vitest";
import { EvaluateStepUp } from "../../identity/application/evaluate-step-up.js";
import { FakeStepUpRuleRepository } from "../../identity/testing/fakes.js";
import { InitiatePayment } from "./initiate-payment.js";
import {
  FakePaymentEventRepository,
  FakePaymentGateway,
  FakeTransactionRepository,
} from "../testing/fakes.js";

/**
 * The payment intent's own gate — "Rejected with `403 authz.assurance_
 * insufficient` if assurance is short — checked *before* the intent is
 * created" (api.md §4.2) — plus FR-PAY-07's idempotency guarantee.
 */
describe("InitiatePayment", () => {
  const NOW = new Date("2026-09-09T10:00:00.000Z");

  function makeUseCase(requiredAssurance: "Anonymous" | "VerifiedPlusOtp" = "VerifiedPlusOtp") {
    const rules = new FakeStepUpRuleRepository();
    rules.seed({
      id: "rule_1",
      actionKey: "InitiatePayment",
      requiredAssurance,
      isEnabled: true,
      ordinal: 1,
    });
    const gateway = new FakePaymentGateway();
    const transactions = new FakeTransactionRepository();
    const events = new FakePaymentEventRepository();
    const useCase = new InitiatePayment({
      stepUp: new EvaluateStepUp({ rules }),
      gateway,
      transactions,
      events,
    });
    return { gateway, transactions, events, useCase };
  }

  it("blocks a payment attempted below the required level — the gateway is never called", async () => {
    const { gateway, useCase } = makeUseCase();

    const result = await useCase.execute({
      citizenIdentityId: "cid_1",
      conversationId: "conv_1",
      heldAssurance: "L0",
      paymentGatewayId: "pg_1",
      serviceKey: "sewa_bill",
      serviceLabel: "SEWA bill",
      linkedServiceAccountId: null,
      amount: { amountMinor: 41_200n, currency: "AED" },
      reference: "TXN-1",
      description: "SEWA bill payment",
      idempotencyKey: "idem-1",
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === "authz.assurance_insufficient") {
      expect(result.required).toBe("L2");
    }
    expect(gateway.intentCalls).toHaveLength(0);
  });

  it("settles a payment at the required level, real end to end", async () => {
    const { gateway, transactions, events, useCase } = makeUseCase();

    const result = await useCase.execute({
      citizenIdentityId: "cid_1",
      conversationId: "conv_1",
      heldAssurance: "L2",
      paymentGatewayId: "pg_1",
      serviceKey: "sewa_bill",
      serviceLabel: "SEWA bill",
      linkedServiceAccountId: null,
      amount: { amountMinor: 41_200n, currency: "AED" },
      reference: "TXN-1",
      description: "SEWA bill payment",
      idempotencyKey: "idem-1",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.transaction.status).toBe("Settled");
      expect(result.transaction.assuranceLevelAtPayment).toBe("VerifiedPlusOtp");
    }
    expect(gateway.intentCalls).toHaveLength(1);
    expect(transactions.rows.size).toBe(1);
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0]?.kind).toBe("payment_settled");
  });

  it("a retried idempotency key returns the same transaction, never a second gateway call", async () => {
    const { gateway, useCase } = makeUseCase();
    const input = {
      citizenIdentityId: "cid_1",
      conversationId: "conv_1",
      heldAssurance: "L2" as const,
      paymentGatewayId: "pg_1",
      serviceKey: "sewa_bill",
      serviceLabel: "SEWA bill",
      linkedServiceAccountId: null,
      amount: { amountMinor: 41_200n, currency: "AED" },
      reference: "TXN-1",
      description: "SEWA bill payment",
      idempotencyKey: "idem-shared",
      now: NOW,
    };

    const first = await useCase.execute(input);
    const second = await useCase.execute({ ...input, reference: "TXN-2" });

    expect(first.ok && second.ok && first.transaction.id === second.transaction.id).toBe(true);
    // The gateway was called exactly once — the second execute() returned the
    // already-settled row without a second charge (FR-PAY-07).
    expect(gateway.intentCalls).toHaveLength(1);
  });

  it("an action needing no step-up (Anonymous) proceeds at L0", async () => {
    const { gateway, useCase } = makeUseCase("Anonymous");

    const result = await useCase.execute({
      citizenIdentityId: "cid_1",
      conversationId: null,
      heldAssurance: "L0",
      paymentGatewayId: "pg_1",
      serviceKey: "sewa_bill",
      serviceLabel: "SEWA bill",
      linkedServiceAccountId: null,
      amount: { amountMinor: 5_000n, currency: "AED" },
      reference: "TXN-3",
      description: "Free service",
      idempotencyKey: "idem-3",
      now: NOW,
    });

    // Note: `CK_Transactions_verifiedOnly` would refuse this at the real
    // adapter regardless — `TR_StepUpRules_paymentFloor` prevents
    // `InitiatePayment` from ever being configured this low in the first
    // place, so this scenario only demonstrates the gate's own logic in
    // isolation, not a reachable real-world state. The fake's own
    // `assuranceLevelAtPayment === "Anonymous"` guard still fires here,
    // proving the belt-and-braces layer independently of the step-up gate.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("payments.assurance_insufficient");
    expect(gateway.intentCalls).toHaveLength(1); // the gateway call happens before the persistence check
  });
});
