/** Context binding a secret to its owner — becomes the envelope's AAD (ADR-0007). */
export interface SecretContext {
  tenantId: string;
  /** e.g. `"credential"`, `"mfa-secret"` — the same value used as the `vault_ref` kind. */
  kind: string;
  id: string;
}

export interface EncryptedSecret {
  /** Opaque `nb://<tenant>/<kind>/<id>` pointer — safe to store in a plaintext column. */
  vaultRef: string;
  /** The two envelope-encrypted blobs the caller persists in its OWN ciphertext column
   * (e.g. `credential.ciphertext` + `credential.dek_ref`). This provider does not
   * persist anything itself — LLD keeps ciphertext storage next to the owning row so
   * DB-level GRANT restrictions (e.g. gateway-only SELECT on `credential.ciphertext`)
   * can be scoped per table. */
  ciphertext: string;
  dekRef: string;
  maskedHint: string;
}

/**
 * The `SecretsProvider` port (LLD §3.5 / ADR-0007). `put()` is safe to call from
 * `apps/web` (initial credential entry, MFA enrollment, rotation); `get()`'s access is
 * restricted for the `credential` table specifically via a DB-level column GRANT
 * (gateway role only — see `packages/db/src/bootstrap/ensure-roles.ts`), not by this
 * interface itself, since the interface is deliberately storage-and-DB-caller-agnostic.
 */
export interface SecretsProvider {
  put(plaintext: string, context: SecretContext): Promise<EncryptedSecret>;
  get(ciphertext: string, dekRef: string, context: SecretContext): Promise<string>;
}
