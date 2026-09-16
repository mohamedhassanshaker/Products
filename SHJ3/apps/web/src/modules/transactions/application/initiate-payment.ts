/**
 * Create a payment intent — `POST /api/public/v1/conversations/{id}/payments/
 * intents` (api.md §4.2), `verified_otp`.
 *
 * Order of operations, and why each step is where it is:
 *
 *  1. **Idempotency first.** FR-PAY-07: a retry with the same client-supplied
 *     key must produce one transaction, not a second charge. Checked before
 *     the assurance gate so a retried, already-succeeded request never
 *     re-evaluates (and cannot be blocked by) a step-up rule that changed
 *     in between.
 *  2. **The step-up gate, before any gateway call.** api.md §3.5/§4.2: "Rejected
 *     with `403 authz.assurance_insufficient` if assurance is short — checked
 *     *before* the intent is created." `EvaluateStepUp` is the same class the
 *     agent runtime's own tool-call gate is built against conceptually (this
 *     module's `docs/api.md` cross-reference), so a payment attempted at `L0`
 *     or `L1` never reaches the gateway.
 *  3. **The gateway call**, with the same idempotency key forwarded — belt and
 *     braces alongside step 1's own row-level check.
 *  4. **Persist**, `assuranceLevelAtPayment` recorded from the *moment of
 *     payment*, never re-read from the identity later — matching
 *     `IdentityLinks.assuranceLevelAtLink`'s identical reasoning
 *     (`docs/data-model.md` §4.12).
 */

import type { AssuranceLevel } from "../../iam/domain/assurance.js";
import { assuranceToRequiredLevel } from "../../identity/domain/assurance-mapping.js";
import type { EvaluateStepUp } from "../../identity/application/evaluate-step-up.js";
import type { Money } from "../domain/money.js";
import type { IdempotencyKey, PaymentGateway } from "../ports/payment-gateway.js";
import type { PaymentEventRepository } from "../ports/payment-event-repository.js";
import type { TransactionRepository, TransactionRow } from "../ports/transaction-repository.js";

export type InitiatePaymentResult =
  | { readonly ok: true; readonly transaction: TransactionRow }
  | {
      readonly ok: false;
      readonly reason: "authz.assurance_insufficient";
      readonly required: AssuranceLevel;
    }
  | { readonly ok: false; readonly reason: "payments.assurance_insufficient" }
  | { readonly ok: false; readonly reason: "payments.declined"; readonly failureCode: string };

export interface InitiatePaymentInput {
  readonly citizenIdentityId: string;
  readonly conversationId: string | null;
  readonly heldAssurance: AssuranceLevel;
  readonly paymentGatewayId: string;
  readonly serviceKey: string;
  readonly serviceLabel: string;
  readonly linkedServiceAccountId: string | null;
  readonly amount: Money;
  readonly reference: string;
  readonly description: string;
  readonly idempotencyKey: string;
  readonly now: Date;
}

export interface InitiatePaymentDeps {
  readonly stepUp: EvaluateStepUp;
  readonly gateway: PaymentGateway;
  readonly transactions: TransactionRepository;
  readonly events: PaymentEventRepository;
}

export class InitiatePayment {
  constructor(private readonly deps: InitiatePaymentDeps) {}

  async execute(input: InitiatePaymentInput): Promise<InitiatePaymentResult> {
    const { stepUp, gateway, transactions, events } = this.deps;

    const existing = await transactions.findByIdempotencyKey(input.idempotencyKey);
    if (existing) return { ok: true, transaction: existing };

    const evaluation = await stepUp.execute({
      action: "InitiatePayment",
      heldAssurance: input.heldAssurance,
    });
    if (!evaluation.allowed) {
      return { ok: false, reason: "authz.assurance_insufficient", required: evaluation.required };
    }

    const key: IdempotencyKey = { value: input.idempotencyKey };
    const intent = await gateway.createIntent(
      {
        amount: input.amount,
        method: "card",
        reference: input.reference,
        description: input.description,
      },
      key,
    );

    const created = await transactions.create({
      reference: input.reference,
      conversationId: input.conversationId,
      citizenIdentityId: input.citizenIdentityId,
      paymentGatewayId: input.paymentGatewayId,
      serviceKey: input.serviceKey,
      serviceLabel: input.serviceLabel,
      linkedServiceAccountId: input.linkedServiceAccountId,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
      assuranceLevelAtPayment: assuranceToRequiredLevel(input.heldAssurance),
      now: input.now,
    });
    if (!created.ok) return { ok: false, reason: "payments.assurance_insufficient" };

    let transaction = created.transaction;
    if (intent.outcome.kind === "settled") {
      transaction = await transactions.settle(
        transaction.id,
        intent.outcome.gatewayReference,
        input.now,
      );
      await events.record({
        transactionId: transaction.id,
        kind: "payment_settled",
        gatewayEventId: `sync_${intent.outcome.gatewayReference}`,
        payloadRedactedJson: JSON.stringify({ gatewayReference: intent.outcome.gatewayReference }),
        signatureVerified: true,
        occurredAt: input.now,
        now: input.now,
      });
    } else if (intent.outcome.kind === "declined") {
      transaction = await transactions.decline(transaction.id, intent.outcome.reason, input.now);
      return { ok: false, reason: "payments.declined", failureCode: intent.outcome.reason };
    }
    // "pending" outcomes stay `Initiated` — a real async gateway's confirmation
    // arrives later via `HandlePaymentCallback`. The bundled mock adapter
    // always settles synchronously (see its own doc comment), so this branch
    // is real, reachable code with no live path to exercise it in this pass —
    // named rather than silently untested.

    return { ok: true, transaction };
  }
}
