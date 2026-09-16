/**
 * 26-character Crockford-base32 ULID (a 48-bit millisecond timestamp followed by 80
 * bits of randomness, both base32-encoded) — every `Char(26)` id column in this
 * schema's contract.
 *
 * Extracted from `tenant-registry.ts`'s own private `newUlid`, which documents exactly
 * why this is hand-rolled rather than a package dependency: no `ulid` package is a
 * dependency of this workspace, and `platform.*` id columns only require `CHAR(26)`
 * with no format CHECK, so a minimal correct implementation is proportionate to what a
 * handful of small adapters need. Shared here once it was needed by a second and third
 * adapter (`prisma-system-skin-seeder.ts`, `migration-status-store.ts`) rather than
 * duplicated a third time — `tenant-registry.ts`'s own copy is left exactly as it is,
 * since touching an already-verified, already-live adapter for a pure refactor is out
 * of scope for this wave.
 */

import { randomBytes } from "node:crypto";

const CROCKFORD_BASE32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

function encodeBase32(value: number, length: number): string {
  let remaining = value;
  let out = "";
  for (let i = 0; i < length; i++) {
    out = CROCKFORD_BASE32[remaining % 32] + out;
    remaining = Math.floor(remaining / 32);
  }
  return out;
}

export function newUlid(now: Date = new Date()): string {
  const time = encodeBase32(now.getTime(), 10);
  const randomness = Array.from(randomBytes(16), (byte) => CROCKFORD_BASE32[byte % 32]).join("");
  return time + randomness;
}
