/**
 * Envelope encryption for secrets stored at rest — `SHJ3_ENCRYPTION_KEY`
 * (deployment.md §16 var #12, config.ts).
 *
 * The first consumer is B-2's `PrismaCredentialRepository` (`StaffCredentials.
 * totpSecretCipher`); deployment.md already names a second, later one — tenant-held
 * connector credentials (MCP OAuth secrets, API connector keys) — which is why this lives
 * in `platform` (the substrate every feature module may depend on, architecture.md §3)
 * rather than inside `iam`, even though `iam` is its only caller today.
 *
 * ## AES-256-GCM, hand-rolled from `node:crypto`
 *
 * The same reasoning `totp.ts` already gives for hand-rolling RFC 6238 applies here:
 * `node:crypto`'s `createCipheriv`/`createDecipheriv` supply the actual primitive: what
 * remains is choosing an IV size, concatenating the three parts a caller needs to persist
 * as one column, and failing loudly on tamper — well short of justifying a new dependency
 * with no CI dependency scanning to catch a bad one (RISK-002).
 *
 *  - **96-bit (12-byte) IV.** The size GCM's own construction is designed around — a
 *    longer IV is hashed down internally before use, which weakens the authentication
 *    guarantee rather than strengthening it. Fully random per call (`randomBytes`), never
 *    a counter: this key encrypts occasional, independent secrets (one TOTP enrolment,
 *    one connector credential), not a high-volume stream where a counter would need
 *    coordinated state across replicas to guarantee no reuse.
 *  - **The auth tag is part of the envelope, not a side channel.** `iv || authTag ||
 *    ciphertext`, one `Buffer` — exactly what a `VarBinary` column stores, and what makes
 *    the ciphertext self-describing: nothing outside this module needs to know GCM's
 *    parameter sizes to persist or retrieve one.
 *  - **Decryption failure is one error, not a family of them.** A wrong key, a flipped
 *    bit, a truncated column and a value encrypted under GCM with a different IV size all
 *    fail the same way — `EnvelopeDecryptionError`, no further detail. Distinguishing them
 *    would tell an attacker holding a modified ciphertext more than "this did not work",
 *    the same non-oracle reasoning `local-password-provider.ts` applies to sign-in.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { loadConfig } from "../../../config.js";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_BYTES = 16;

function encryptionKeyBuffer(): Buffer {
  // Re-decoded on every call rather than cached at module load: `loadConfig()` is already
  // memoised (config.ts), so this costs one base64 decode per encrypt/decrypt — cheap, and
  // it means a test that calls `resetConfigForTesting()` between cases is never looking at
  // a stale key from a previous one.
  return Buffer.from(loadConfig().encryptionKey, "base64");
}

/**
 * Envelope-encrypt `plain`. Returns `iv || authTag || ciphertext` as one `Buffer` — the
 * shape every `*Cipher` column in this schema stores (`StaffCredentials.totpSecretCipher`
 * today).
 */
export function encryptSecret(plain: string): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, encryptionKeyBuffer(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

/** Corrupt, truncated, tampered, or encrypted under a different `SHJ3_ENCRYPTION_KEY`. One reason, deliberately — see the module comment. */
export class EnvelopeDecryptionError extends Error {
  constructor() {
    super(
      "Envelope decryption failed. The ciphertext is corrupt or truncated, or it was " +
        "encrypted under a different SHJ3_ENCRYPTION_KEY than the one currently configured.",
    );
    this.name = "EnvelopeDecryptionError";
  }
}

/** Reverse of `encryptSecret`. Throws `EnvelopeDecryptionError` rather than returning a partial or unauthenticated result. */
export function decryptSecret(envelope: Buffer): string {
  if (envelope.length < IV_BYTES + AUTH_TAG_BYTES) {
    throw new EnvelopeDecryptionError();
  }
  const iv = envelope.subarray(0, IV_BYTES);
  const authTag = envelope.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = envelope.subarray(IV_BYTES + AUTH_TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, encryptionKeyBuffer(), iv);
  decipher.setAuthTag(authTag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM's authentication check fails inside `final()` for any tamper or wrong key —
    // caught and re-thrown as the one error this module ever raises for a bad envelope.
    throw new EnvelopeDecryptionError();
  }
}
