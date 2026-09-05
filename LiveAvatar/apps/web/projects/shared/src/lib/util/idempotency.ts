/** Header name the API expects (mirrors `HEADER_IDEMPOTENCY_KEY` in `packages/contracts`). */
export const IDEMPOTENCY_KEY_HEADER = 'Idempotency-Key';

/**
 * Mints a fresh idempotency key for a mutating request (LLD §5.1 idempotency
 * contract). Uses the platform `crypto.randomUUID` — available in every
 * browser this product targets (Chrome/Edge/Firefox/Safari current).
 */
export function createIdempotencyKey(): string {
  return crypto.randomUUID();
}
