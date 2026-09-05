import { describe, expect, it } from "vitest";
import { buildVaultRef, parseVaultRef } from "./vault-ref.js";

describe("vault_ref (LLD §3.5 opaque pointer format)", () => {
  it("builds the nb://<tenant>/<kind>/<id> format", () => {
    expect(buildVaultRef("tenant-1", "connector-credential", "cred-1")).toBe("nb://tenant-1/connector-credential/cred-1");
  });

  it("round-trips build -> parse", () => {
    const ref = buildVaultRef("tenant-1", "mfa-secret", "row-1");
    expect(parseVaultRef(ref)).toEqual({ tenantId: "tenant-1", kind: "mfa-secret", id: "row-1" });
  });

  it("throws on a malformed ref", () => {
    expect(() => parseVaultRef("not-a-vault-ref")).toThrow();
    expect(() => parseVaultRef("nb://only-one-segment")).toThrow();
  });
});
