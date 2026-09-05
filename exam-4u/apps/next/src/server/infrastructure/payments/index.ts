import type { PaymentGatewayPort } from '@/server/common/ports/payment-gateway.port';
import { StripePaymentGatewayAdapter } from './stripe.adapter';

export { StripePaymentGatewayAdapter };

/**
 * `server/infrastructure/payments`'s public barrel (migration plan Phase 2 sub-slice "2c"). Nothing
 * outside this module may import `./stripe.adapter` directly (enforced by
 * `apps/next/.eslintrc.cjs`'s `infrastructure/payments` module-boundary rule) — every consumer depends
 * on `PaymentGatewayPort` (`server/common/ports`) instead, mirroring `infrastructure/storage`'s
 * `createStoragePort`/`infrastructure/mail`'s `createEmailPort` precedent exactly.
 *
 * Unlike `createStoragePort`'s `driver` enum (multiple candidate implementations), there is only one
 * real payment provider in this app's scope (Stripe) — so this factory takes the two Stripe secrets
 * directly rather than a driver-selection parameter. Construction is always cheap/side-effect-free
 * (the real `Stripe` client itself is built lazily inside the adapter, only on first actual API call)
 * so this factory never throws even when `secretKey`/`webhookSecret` are empty — `BillingCheckoutService`
 * owns the explicit `BILLING_NOT_CONFIGURED` guard before ever calling a method on the returned port.
 */
export function createPaymentGatewayPort(secretKey: string, webhookSecret: string): PaymentGatewayPort {
  return new StripePaymentGatewayAdapter(secretKey, webhookSecret);
}
