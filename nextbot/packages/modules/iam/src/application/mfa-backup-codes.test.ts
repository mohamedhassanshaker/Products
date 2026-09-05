import { describe, expect, it, vi, beforeEach } from "vitest";

const getBackupCodesRef = vi.fn();
const setBackupCodesRef = vi.fn();

vi.mock("../infrastructure/user-repository.js", () => ({
  getBackupCodesRef: (...a: unknown[]) => getBackupCodesRef(...a),
  setBackupCodesRef: (...a: unknown[]) => setBackupCodesRef(...a),
}));

const ctx = { tenantId: "t1", region: "US" as const, environment: "Production" as const };

describe("mfa-backup-codes (unit — QA Defect B2)", () => {
  beforeEach(() => {
    getBackupCodesRef.mockReset();
    setBackupCodesRef.mockReset();
  });

  it("generateAndPersistBackupCodes returns 10 unique plaintext codes and persists only hashes", async () => {
    const { generateAndPersistBackupCodes } = await import("./mfa-backup-codes.js");
    const codes = await generateAndPersistBackupCodes(ctx, "u1");
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);

    expect(setBackupCodesRef).toHaveBeenCalledTimes(1);
    const [, , serialized] = setBackupCodesRef.mock.calls[0] as [unknown, unknown, string];
    const stored = JSON.parse(serialized) as Array<{ hash: string; usedAt: string | null }>;
    expect(stored).toHaveLength(10);
    for (const entry of stored) {
      expect(entry.usedAt).toBeNull();
      // Never the plaintext code itself.
      expect(codes).not.toContain(entry.hash);
      expect(entry.hash).toMatch(/^\$argon2/);
    }
  });

  it("consumeBackupCode returns false when no backup codes were ever generated", async () => {
    getBackupCodesRef.mockResolvedValue(null);
    const { consumeBackupCode } = await import("./mfa-backup-codes.js");
    await expect(consumeBackupCode(ctx, "u1", "1234567890")).resolves.toBe(false);
    expect(setBackupCodesRef).not.toHaveBeenCalled();
  });

  it("consumeBackupCode accepts a valid unused code, marks it consumed, and rejects reuse", async () => {
    const { generateAndPersistBackupCodes, consumeBackupCode } = await import("./mfa-backup-codes.js");

    let persisted: string | null = null;
    setBackupCodesRef.mockImplementation(async (_ctx: unknown, _userId: unknown, serialized: string) => {
      persisted = serialized;
    });
    getBackupCodesRef.mockImplementation(async () => persisted);

    const codes = await generateAndPersistBackupCodes(ctx, "u1");
    const target = codes[3]!;

    await expect(consumeBackupCode(ctx, "u1", target)).resolves.toBe(true);
    await expect(consumeBackupCode(ctx, "u1", target)).resolves.toBe(false);
    // An unrelated, never-issued code must never match.
    await expect(consumeBackupCode(ctx, "u1", "0000000000")).resolves.toBe(false);
  });

  it("consumeBackupCode returns false for malformed stored JSON rather than throwing", async () => {
    getBackupCodesRef.mockResolvedValue("not-json");
    const { consumeBackupCode } = await import("./mfa-backup-codes.js");
    await expect(consumeBackupCode(ctx, "u1", "1234567890")).resolves.toBe(false);
  });
});
