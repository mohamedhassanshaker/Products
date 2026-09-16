/**
 * Composition root for `/identity` (B11: Identity & transactions) — mirrors
 * `(backoffice)/tools/composition.ts`'s exact shape: a fresh, stateless real
 * adapter per call, ports only reaching `page.tsx`/`actions.ts`.
 */

import { PrismaStepUpRuleRepository } from "../../../../modules/identity/adapters/outbound/sql/prisma-step-up-rule-repository.js";
import { PrismaVerificationConfigRepository } from "../../../../modules/identity/adapters/outbound/sql/prisma-verification-config-repository.js";
import { PrismaRefundRequestRepository } from "../../../../modules/transactions/adapters/outbound/sql/prisma-refund-request-repository.js";
import { PrismaTransactionRepository } from "../../../../modules/transactions/adapters/outbound/sql/prisma-transaction-repository.js";
import { PrismaPaymentEventRepository } from "../../../../modules/transactions/adapters/outbound/sql/prisma-payment-event-repository.js";
import { createMockPaymentGateway } from "../../../../modules/transactions/adapters/outbound/payment/mock-payment-gateway.js";
import type { MockPaymentGateway } from "../../../../modules/transactions/adapters/outbound/payment/mock-payment-gateway.js";
import { loadConfig } from "../../../../modules/platform/config.js";

export function stepUpRuleRepository(): PrismaStepUpRuleRepository {
  return new PrismaStepUpRuleRepository();
}

export function verificationConfigRepository(): PrismaVerificationConfigRepository {
  return new PrismaVerificationConfigRepository();
}

export function transactionRepository(): PrismaTransactionRepository {
  return new PrismaTransactionRepository();
}

export function refundRequestRepository(): PrismaRefundRequestRepository {
  return new PrismaRefundRequestRepository();
}

export function paymentEventRepository(): PrismaPaymentEventRepository {
  return new PrismaPaymentEventRepository();
}

/**
 * The payment gateway adapter this deployment is actually configured with.
 * Only `MockPaymentGateway` exists behind this port in this codebase (no real
 * processor is integrated — see that adapter's own doc comment); its
 * constructor refuses outright if `SHJ3_ENVIRONMENT=production`, so this
 * composition root never needs its own environment branch to stay safe.
 */
export function paymentGateway(): MockPaymentGateway {
  return createMockPaymentGateway(loadConfig(), { clock: { now } });
}

export function now(): Date {
  return new Date();
}
