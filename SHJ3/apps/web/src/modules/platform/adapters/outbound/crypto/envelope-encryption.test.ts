import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTesting } from "../../../config.js";
import { EnvelopeDecryptionError, decryptSecret, encryptSecret } from "./envelope-encryption.js";

/**
 * AES-256-GCM envelope encryption — `SHJ3_ENCRYPTION_KEY` (config.ts, deployment.md §16
 * var #12). The real cipher is exercised directly (no fake): unlike Argon2id, an AES-GCM
 * round trip is fast enough that hiding it behind a fake seam (`local-password-provider.
 * ts`'s own reasoning) would buy nothing here.
 */

const KEY_A = randomBytes(32).toString("base64");
const KEY_B = randomBytes(32).toString("base64");

function withKey(key: string): void {
  process.env.SHJ3_ENVIRONMENT = "development";
  process.env.SHJ3_SQL_URL = "sqlserver://localhost:1433;database=shj3";
  process.env.SHJ3_REDIS_URL = "redis://localhost:6379";
  process.env.SHJ3_SESSION_SECRET = "test-session-secret-at-least-32-chars";
  process.env.SHJ3_VERIFICATION_ADAPTER = "mock";
  process.env.SHJ3_PAYMENT_GATEWAY_ADAPTER = "mock";
  process.env.SHJ3_ENCRYPTION_KEY = key;
  resetConfigForTesting();
}

beforeEach(() => {
  withKey(KEY_A);
});

afterEach(() => {
  resetConfigForTesting();
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips the plaintext exactly", () => {
    const plain = "JBSWY3DPEHPK3PXP"; // a plausible base32 TOTP secret
    expect(decryptSecret(encryptSecret(plain))).toBe(plain);
  });

  it("round-trips an empty string and unicode content", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
    expect(decryptSecret(encryptSecret("سر التحقق 🔐"))).toBe("سر التحقق 🔐");
  });

  it("produces a different ciphertext (and IV) on every call — never reuses an IV", () => {
    const plain = "same-secret-every-time";
    const first = encryptSecret(plain);
    const second = encryptSecret(plain);
    expect(first.equals(second)).toBe(false);
    // The IV is the envelope's first 12 bytes.
    expect(first.subarray(0, 12).equals(second.subarray(0, 12))).toBe(false);
  });

  it("rejects a ciphertext tampered after encryption", () => {
    const envelope = encryptSecret("do-not-tamper");
    const tampered = Buffer.from(envelope);
    tampered[tampered.length - 1] = (tampered[tampered.length - 1]! ^ 0xff) & 0xff;
    expect(() => decryptSecret(tampered)).toThrow(EnvelopeDecryptionError);
  });

  it("rejects an envelope encrypted under a different key", () => {
    const envelope = encryptSecret("cross-key-should-fail");
    withKey(KEY_B);
    expect(() => decryptSecret(envelope)).toThrow(EnvelopeDecryptionError);
  });

  it("rejects a truncated envelope rather than throwing an unrelated error", () => {
    const envelope = encryptSecret("truncate-me");
    expect(() => decryptSecret(envelope.subarray(0, 5))).toThrow(EnvelopeDecryptionError);
  });
});
