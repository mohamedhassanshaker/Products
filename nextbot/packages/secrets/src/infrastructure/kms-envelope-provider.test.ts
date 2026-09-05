import { describe, expect, it } from "vitest";
import { KmsEnvelopeSecretsProvider } from "./kms-envelope-provider.js";

const MASTER_KEY = "1".repeat(64);

describe("KmsEnvelopeSecretsProvider (ADR-0007 local/dev KMS stub)", () => {
  it("round-trips put -> get", async () => {
    const provider = new KmsEnvelopeSecretsProvider(MASTER_KEY);
    const encrypted = await provider.put("sk-live-abc123", { tenantId: "t1", kind: "connector-credential", id: "cred-1" });
    expect(encrypted.vaultRef).toBe("nb://t1/connector-credential/cred-1");
    expect(encrypted.maskedHint).toBe("sk-…c123");

    const plaintext = await provider.get(encrypted.ciphertext, encrypted.dekRef, { tenantId: "t1", kind: "connector-credential", id: "cred-1" });
    expect(plaintext).toBe("sk-live-abc123");
  });

  it("throws at construction time when the master key is missing/malformed (startup config failure, LLD §11.10)", () => {
    // Pass explicit bad values rather than `undefined` — this test environment's
    // .env.test genuinely sets NEXTBOT_KMS_MASTER_KEY, so relying on the
    // env-fallback default would test the wrong thing here.
    expect(() => new KmsEnvelopeSecretsProvider("")).toThrow();
    expect(() => new KmsEnvelopeSecretsProvider("too-short")).toThrow();
  });

  it("fails to decrypt when the context (AAD) doesn't match the one used to encrypt", async () => {
    const provider = new KmsEnvelopeSecretsProvider(MASTER_KEY);
    const encrypted = await provider.put("secret", { tenantId: "t1", kind: "connector-credential", id: "cred-1" });
    await expect(
      provider.get(encrypted.ciphertext, encrypted.dekRef, { tenantId: "t2", kind: "connector-credential", id: "cred-1" }),
    ).rejects.toThrow();
  });
});
