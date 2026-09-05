import { generateId } from "@nextbot/db";
import { buildAad, envelopeDecrypt, envelopeEncrypt, maskSecret } from "../domain/envelope-crypto.js";
import { buildVaultRef } from "../domain/vault-ref.js";
import type { EncryptedSecret, SecretContext, SecretsProvider } from "../ports/secrets-provider.js";

/**
 * Local/dev KMS-backed `SecretsProvider` (ADR-0007). The **interface** is the real
 * production one; only the KEK source is a stub — `NEXTBOT_KMS_MASTER_KEY` (a 32-byte
 * hex string from env) stands in for a call to a real regional cloud KMS
 * (`GenerateDataKey`/`Decrypt`). Swapping the production path in means implementing
 * this same `SecretsProvider` interface against the real KMS SDK and changing which
 * implementation the composition root registers — no caller code changes.
 *
 * `dekRef` here is simply the wrapped-DEK blob itself (there is no external KMS
 * "key version id" to reference in the dev stub); a real KMS-backed implementation
 * would instead return the KMS-issued key/version identifier and re-fetch/unwrap via
 * a `Decrypt` API call in `get()`.
 */
export class KmsEnvelopeSecretsProvider implements SecretsProvider {
  private readonly kek: Buffer;

  constructor(masterKeyHex = process.env.NEXTBOT_KMS_MASTER_KEY) {
    if (!masterKeyHex || masterKeyHex.length !== 64) {
      throw new Error(
        "KmsEnvelopeSecretsProvider: NEXTBOT_KMS_MASTER_KEY must be a 64-character hex string (32 bytes) — startup config failure.",
      );
    }
    this.kek = Buffer.from(masterKeyHex, "hex");
  }

  async put(plaintext: string, context: SecretContext): Promise<EncryptedSecret> {
    const id = context.id || generateId();
    const aad = buildAad({ tenantId: context.tenantId, kind: context.kind, id });
    const envelope = envelopeEncrypt(this.kek, plaintext, aad);
    return {
      vaultRef: buildVaultRef(context.tenantId, context.kind, id),
      ciphertext: envelope.data,
      dekRef: envelope.wrappedDek,
      maskedHint: maskSecret(plaintext),
    };
  }

  async get(ciphertext: string, dekRef: string, context: SecretContext): Promise<string> {
    const aad = buildAad(context);
    return envelopeDecrypt(this.kek, { data: ciphertext, wrappedDek: dekRef }, aad);
  }
}
