import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * ADR-0007 envelope encryption primitives: AES-256-GCM under a per-secret Data
 * Encryption Key (DEK), the DEK itself wrapped (AES-256-GCM) under a Key Encryption
 * Key (KEK/CMK). AAD binds the ciphertext to its owning context (tenant/kind/id) so a
 * ciphertext blob cannot be replayed under another tenant or purpose even if copied
 * between rows.
 *
 * This file implements the **algorithm** only; `kms-envelope-provider.ts` supplies the
 * KEK (a local/dev stub reading `NEXTBOT_KMS_MASTER_KEY` from env — the production
 * path is a real cloud KMS `Decrypt`/`GenerateDataKey` call behind the identical
 * `SecretsProvider` interface, per ADR-0007 §"local/dev KMS stub acceptable so long as
 * the interface is the real one").
 */

const DEK_BYTES = 32; // AES-256
const IV_BYTES = 12; // GCM standard nonce size
const AUTH_TAG_BYTES = 16;

export interface EnvelopeCiphertext {
  /** `iv (12) || authTag (16) || ciphertext` for the data itself, base64. */
  data: string;
  /** `iv (12) || authTag (16) || wrapped DEK` under the KEK, base64. */
  wrappedDek: string;
}

/** Builds canonical AAD bytes from an owning context — order matters (it's part of the authenticated data). */
export function buildAad(context: { tenantId: string; kind: string; id: string }): Buffer {
  return Buffer.from(`${context.tenantId}:${context.kind}:${context.id}`, "utf8");
}

function aesGcmEncrypt(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function aesGcmDecrypt(key: Buffer, blob: Buffer, aad: Buffer): Buffer {
  const iv = blob.subarray(0, IV_BYTES);
  const authTag = blob.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + AUTH_TAG_BYTES);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(aad);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Encrypts `plaintext` under a freshly-generated DEK, itself wrapped under `kek`. */
export function envelopeEncrypt(kek: Buffer, plaintext: string, aad: Buffer): EnvelopeCiphertext {
  const dek = randomBytes(DEK_BYTES);
  const data = aesGcmEncrypt(dek, Buffer.from(plaintext, "utf8"), aad);
  const wrappedDek = aesGcmEncrypt(kek, dek, aad);
  return { data: data.toString("base64"), wrappedDek: wrappedDek.toString("base64") };
}

/** Reverses `envelopeEncrypt`. Throws if `aad` doesn't match what was used to encrypt
 * (GCM auth-tag verification failure) — this is the mechanism that makes AAD binding
 * load-bearing, not just documentation. */
export function envelopeDecrypt(kek: Buffer, envelope: EnvelopeCiphertext, aad: Buffer): string {
  const dek = aesGcmDecrypt(kek, Buffer.from(envelope.wrappedDek, "base64"), aad);
  const plaintext = aesGcmDecrypt(dek, Buffer.from(envelope.data, "base64"), aad);
  return plaintext.toString("utf8");
}

/** Renders a masked hint (e.g. `sk-…9fA2`) — the only form of a secret any UI ever renders. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `${plaintext.slice(0, 3)}…${plaintext.slice(-4)}`;
}
