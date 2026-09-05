import { describe, expect, it } from "vitest";
import { buildAad, envelopeDecrypt, envelopeEncrypt, maskSecret } from "./envelope-crypto.js";

const KEK = Buffer.from("1".repeat(64), "hex");

describe("envelope encryption (ADR-0007)", () => {
  it("round-trips plaintext through encrypt/decrypt", () => {
    const aad = buildAad({ tenantId: "tenant-1", kind: "connector-credential", id: "cred-1" });
    const envelope = envelopeEncrypt(KEK, "s3cr3t-value", aad);
    expect(envelopeDecrypt(KEK, envelope, aad)).toBe("s3cr3t-value");
  });

  it("never stores the plaintext in either ciphertext blob", () => {
    const aad = buildAad({ tenantId: "tenant-1", kind: "connector-credential", id: "cred-1" });
    const envelope = envelopeEncrypt(KEK, "s3cr3t-value", aad);
    expect(envelope.data).not.toContain("s3cr3t");
    expect(envelope.wrappedDek).not.toContain("s3cr3t");
  });

  it("fails to decrypt when AAD doesn't match (tenant/kind/id binding is load-bearing)", () => {
    const aad = buildAad({ tenantId: "tenant-1", kind: "connector-credential", id: "cred-1" });
    const envelope = envelopeEncrypt(KEK, "s3cr3t-value", aad);
    const wrongAad = buildAad({ tenantId: "tenant-2", kind: "connector-credential", id: "cred-1" });
    expect(() => envelopeDecrypt(KEK, envelope, wrongAad)).toThrow();
  });

  it("fails to decrypt under a different KEK", () => {
    const aad = buildAad({ tenantId: "tenant-1", kind: "connector-credential", id: "cred-1" });
    const envelope = envelopeEncrypt(KEK, "s3cr3t-value", aad);
    const otherKek = Buffer.from("2".repeat(64), "hex");
    expect(() => envelopeDecrypt(otherKek, envelope, aad)).toThrow();
  });

  it("produces different ciphertext each time (random IV/DEK) even for identical plaintext+AAD", () => {
    const aad = buildAad({ tenantId: "t", kind: "k", id: "i" });
    const first = envelopeEncrypt(KEK, "same", aad);
    const second = envelopeEncrypt(KEK, "same", aad);
    expect(first.data).not.toBe(second.data);
  });
});

describe("maskSecret", () => {
  it("renders a short prefix + ellipsis + last 4 chars for a long secret", () => {
    expect(maskSecret("sk-abcdefgh9fA2")).toBe("sk-…9fA2");
  });

  it("fully masks a very short secret", () => {
    expect(maskSecret("ab")).toBe("••••");
  });
});
