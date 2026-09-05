import { describe, expect, it } from "vitest";
import { generateBackupCodes, generateChallengeToken, generateTotpEnrollment, verifyTotpCode } from "./totp.js";
import { TOTP, Secret } from "otpauth";

describe("TOTP MFA (FR-SEC-03, fully implemented method this phase)", () => {
  it("generates a base32 secret and a matching otpauth:// URI", () => {
    const enrollment = generateTotpEnrollment("user@tenant.example");
    expect(enrollment.secretBase32.length).toBeGreaterThan(0);
    expect(enrollment.otpauthUri).toMatch(/^otpauth:\/\/totp\//);
  });

  it("verifies a code generated from the same secret", () => {
    const enrollment = generateTotpEnrollment("user@tenant.example");
    const totp = new TOTP({ secret: Secret.fromBase32(enrollment.secretBase32), digits: 6, period: 30, algorithm: "SHA1" });
    const code = totp.generate();
    expect(verifyTotpCode(enrollment.secretBase32, code)).toBe(true);
  });

  it("rejects an incorrect code", () => {
    const enrollment = generateTotpEnrollment("user@tenant.example");
    expect(verifyTotpCode(enrollment.secretBase32, "000000")).toBe(false);
  });

  it("generates the requested number of unique backup codes", () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const code of codes) expect(code).toMatch(/^\d{10}$/);
  });

  it("generates a URL-safe, non-empty challenge token", () => {
    const token = generateChallengeToken();
    expect(token.length).toBeGreaterThan(0);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
