/**
 * `MockPaymentGateway` — a deterministic sandbox fixture behind the real
 * `PaymentGateway` port, built to the same "mock is a first-class fixture,
 * refused in production" discipline ADR-0006 established for
 * `MockVerificationProvider` (`iam/adapters/outbound/mock-verification-
 * provider.ts`). **No real payment processor is called anywhere in this
 * codebase** — that is the module's own hard requirement, not a scope cut:
 * this adapter is the only implementation of `PaymentGateway` here, and it
 * settles deterministically in-process.
 *
 * ## Why it settles synchronously rather than staying `Pending`
 *
 * A real gateway commonly confirms asynchronously via webhook
 * (`HandlePaymentCallback` exists for exactly that shape). This fixture
 * settles every `createIntent` call immediately unless driven otherwise
 * (`rejectNext`), because a synchronous sandbox is what a test-mode card
 * numbered for instant approval behaves like in practice, and it keeps the
 * end-to-end proof (`initiate payment -> receipt -> refund`) reachable in one
 * request rather than needing a second, separately-triggered webhook call for
 * the common path. `HandlePaymentCallback`'s idempotent webhook handling is
 * still real and still exercised — by `ApproveRefund`'s own `refund_settled`
 * event and by a driven `Failed`/`Declined` intent.
 *
 * ## It cannot boot in production
 *
 * Enforced twice, exactly mirroring `MockVerificationProvider`'s own two
 * lines of defence: `platform/config.ts`'s `SHJ3_PAYMENT_GATEWAY_ADAPTER` /
 * environment validation is the process-level guarantee (not yet wired — see
 * this wave's review for the flagged follow-up); `createMockPaymentGateway`
 * below is the object-level guarantee, load-bearing on its own regardless of
 * whether every future call site remembers the first.
 */

import { randomUUID } from "node:crypto";
import type { Shj3Config } from "../../../../platform/config.js";
import type { Money } from "../../../domain/money.js";
import type {
  DeclineReason,
  GatewayEvent,
  GatewayRef,
  GatewayTransaction,
  IdempotencyKey,
  PaymentGateway,
  PaymentIntent,
  PaymentIntentOutcome,
  PaymentIntentRequest,
  PaymentMethod,
  RefundResult,
} from "../../../ports/payment-gateway.js";

export interface MockPaymentGatewayDeps {
  readonly clock: { now(): Date };
}

export class MockPaymentGateway implements PaymentGateway {
  readonly key = "mock-sandbox";
  readonly mode: "Live" | "Sandbox" = "Sandbox";

  private readonly intents = new Map<string, PaymentIntentOutcome>();
  /** Set by `rejectNext`. Consumed by the next `createIntent`, one forced failure at a time. */
  private nextDecline: DeclineReason | null = null;

  constructor(private readonly deps: MockPaymentGatewayDeps) {}

  /** Drive the next `createIntent` to a decline — the unhappy path a sandbox test needs reachable. */
  rejectNext(reason: DeclineReason = "gateway_declined"): void {
    this.nextDecline = reason;
  }

  async createIntent(request: PaymentIntentRequest, key: IdempotencyKey): Promise<PaymentIntent> {
    // `request` is unused by design — this fixture keys its recorded outcome
    // entirely off the idempotency key, matching a real sandbox test-mode
    // gateway that settles deterministically regardless of the request body.
    void request;
    // Idempotent at the gateway layer too — a retried key returns the same
    // recorded outcome rather than minting a second charge, belt-and-braces
    // alongside `TransactionRepository.findByIdempotencyKey`'s own check.
    const existing = this.intents.get(key.value);
    if (existing) return { gatewayReference: gatewayRefFor(key.value), outcome: existing };

    const reference = gatewayRefFor(key.value);
    const decline = this.nextDecline;
    this.nextDecline = null;

    const outcome: PaymentIntentOutcome = decline
      ? { kind: "declined", gatewayReference: reference, reason: decline }
      : { kind: "settled", gatewayReference: reference };

    this.intents.set(key.value, outcome);
    return { gatewayReference: reference, outcome };
  }

  async getTransaction(ref: GatewayRef): Promise<GatewayTransaction> {
    for (const outcome of this.intents.values()) {
      if (outcome.gatewayReference === ref.gatewayReference) {
        return { gatewayReference: ref.gatewayReference, outcome };
      }
    }
    throw new Error(`No mock gateway intent for reference "${ref.gatewayReference}".`);
  }

  async refund(_ref: GatewayRef, _amount: Money, key: IdempotencyKey): Promise<RefundResult> {
    void _ref;
    void _amount;
    const decline = this.nextDecline;
    this.nextDecline = null;
    if (decline)
      return { gatewayRefundReference: null, outcome: { kind: "declined", reason: decline } };

    const gatewayRefundReference = `mockrefund_${key.value}`;
    return { gatewayRefundReference, outcome: { kind: "refunded", gatewayRefundReference } };
  }

  async parseCallback(
    rawBody: Uint8Array,
    headers: ReadonlyMap<string, string>,
  ): Promise<GatewayEvent> {
    // A real adapter verifies an HMAC signature here and throws on mismatch —
    // this fixture's "signature" is a fixed header, honest about being a mock
    // rather than pretending to implement real cryptographic verification.
    if (headers.get("x-mock-signature") !== "mock-signature") {
      throw new Error("MockPaymentGateway: callback signature verification failed.");
    }
    const body = JSON.parse(new TextDecoder().decode(rawBody)) as {
      gatewayReference: string;
      kind: GatewayEvent["kind"];
    };
    return {
      gatewayEventId: `evt_${randomUUID()}`,
      gatewayReference: body.gatewayReference,
      kind: body.kind,
      occurredAt: this.deps.clock.now(),
      payloadRedactedJson: JSON.stringify({
        gatewayReference: body.gatewayReference,
        kind: body.kind,
      }),
    };
  }

  supportedMethods(): readonly PaymentMethod[] {
    return ["card", "apple_pay", "bank_transfer", "direct_debit"];
  }
}

function gatewayRefFor(idempotencyKeyValue: string): string {
  return `mockpay_${idempotencyKeyValue}`;
}

/**
 * Construct the mock, refusing in production — the payments analogue of
 * `createMockVerificationProvider` (ADR-0006 rule 6, applied here because a
 * mocked payment path in front of real citizen money is exactly as dangerous
 * as a mocked verification path in front of real payments). There is
 * deliberately no override parameter.
 */
export function createMockPaymentGateway(
  config: Shj3Config,
  deps: MockPaymentGatewayDeps,
): MockPaymentGateway {
  if (config.environment === "production") {
    throw new Error(
      "MockPaymentGateway cannot be constructed in production. It settles every payment " +
        "intent deterministically with no real money movement, which in front of the real " +
        "payment endpoints is an unauthenticated charge path. Configure a real, production-" +
        "grade PaymentGateway adapter (SharjahPayGateway / SewaDirectDebitGateway, api.md §9.10).",
    );
  }
  return new MockPaymentGateway(deps);
}
