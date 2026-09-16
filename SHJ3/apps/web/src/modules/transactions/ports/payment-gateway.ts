/**
 * `PaymentGateway` — api.md §9.10. Move money, behind a port so the domain
 * never learns a vendor's shape.
 *
 * Declines are normalised to a closed, SHJ3-owned vocabulary — never an
 * acquirer's own text (api.md §2.4) — and every mutating method takes an
 * `IdempotencyKey` as a **required** parameter, matching §1.5's "the type
 * system makes an unguarded charge unexpressible."
 *
 * **No real production payment processor is called from this codebase.** The
 * only adapter behind this port is `MockPaymentGateway`
 * (`adapters/outbound/payment/mock-payment-gateway.ts`), a deterministic
 * sandbox fixture — the same "mock adapter, real port, production refused"
 * discipline ADR-0006 established for `VerificationProvider`, applied here
 * because a mocked payment path in front of real citizen money is exactly as
 * dangerous as a mocked verification path in front of real payments.
 */

import type { Money } from "../domain/money.js";

export const PAYMENT_METHODS = ["card", "apple_pay", "bank_transfer", "direct_debit"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/** SHJ3's own closed decline vocabulary (api.md §2.4) — never the gateway's own text. */
export const DECLINE_REASONS = [
  "insufficient_funds",
  "card_expired",
  "do_not_honour",
  "limit_exceeded",
  "gateway_declined",
] as const;
export type DeclineReason = (typeof DECLINE_REASONS)[number];

export interface IdempotencyKey {
  readonly value: string;
}

export interface PaymentIntentRequest {
  readonly amount: Money;
  readonly method: PaymentMethod;
  readonly reference: string;
  readonly description: string;
}

export type PaymentIntentOutcome =
  | { readonly kind: "pending"; readonly gatewayReference: string }
  | { readonly kind: "settled"; readonly gatewayReference: string }
  | {
      readonly kind: "declined";
      readonly gatewayReference: string;
      readonly reason: DeclineReason;
    };

export interface PaymentIntent {
  readonly gatewayReference: string;
  readonly outcome: PaymentIntentOutcome;
}

export interface GatewayRef {
  readonly gatewayReference: string;
}

export interface GatewayTransaction {
  readonly gatewayReference: string;
  readonly outcome: PaymentIntentOutcome;
}

export type RefundOutcome =
  | { readonly kind: "refunded"; readonly gatewayRefundReference: string }
  | { readonly kind: "declined"; readonly reason: DeclineReason };

export interface RefundResult {
  readonly gatewayRefundReference: string | null;
  readonly outcome: RefundOutcome;
}

/** A normalised webhook/callback event — never the gateway's raw payload past this boundary. */
export interface GatewayEvent {
  readonly gatewayEventId: string;
  readonly gatewayReference: string;
  readonly kind: "payment_settled" | "payment_failed" | "refund_settled";
  readonly occurredAt: Date;
  /** Already redacted — `PaymentEvents.payloadRedactedJson`'s own contract. */
  readonly payloadRedactedJson: string;
}

export interface PaymentGateway {
  readonly key: string;
  readonly mode: "Live" | "Sandbox";

  createIntent(request: PaymentIntentRequest, key: IdempotencyKey): Promise<PaymentIntent>;
  getTransaction(ref: GatewayRef): Promise<GatewayTransaction>;
  refund(ref: GatewayRef, amount: Money, key: IdempotencyKey): Promise<RefundResult>;

  /** Verify a callback signature and normalise it. Throws on an unverifiable signature — the adapter is the only place that knows this gateway's scheme. */
  parseCallback(rawBody: Uint8Array, headers: ReadonlyMap<string, string>): Promise<GatewayEvent>;

  supportedMethods(): readonly PaymentMethod[];
}
