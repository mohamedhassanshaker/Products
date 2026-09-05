// PUBLIC API for "@nextbot/secrets" (LLD §3.5, ADR-0007).
export type { SecretsProvider, SecretContext, EncryptedSecret } from "./ports/secrets-provider.js";
export { KmsEnvelopeSecretsProvider } from "./infrastructure/kms-envelope-provider.js";
export { buildVaultRef, parseVaultRef, type ParsedVaultRef } from "./domain/vault-ref.js";
export { maskSecret } from "./domain/envelope-crypto.js";
