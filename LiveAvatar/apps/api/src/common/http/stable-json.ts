import { createHash } from 'node:crypto';

/**
 * Deterministic JSON stringify so idempotency hashes ignore key order.
 * @param value - Request body
 * @returns Canonical JSON string
 */
export function stableStringify(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map((v) => stableStringify(v)).join(',')}]`;
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * SHA-256 hex of the canonical body.
 * @param value - Request body
 * @returns 64-char hex digest
 */
export function hashRequestBody(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
