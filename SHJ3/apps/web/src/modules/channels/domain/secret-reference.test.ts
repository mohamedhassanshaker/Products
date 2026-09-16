import { describe, expect, it } from "vitest";
import { isValidSecretReference } from "./secret-reference.js";

describe("isValidSecretReference", () => {
  it.each(["env:SEWA_WHATSAPP_TOKEN", "k8s:secret/whatsapp-token", "vault:secret/data/whatsapp"])(
    "accepts %s",
    (value) => {
      expect(isValidSecretReference(value)).toBe(true);
    },
  );

  it.each([
    "sk_live_real_secret",
    "https://example.com/secret",
    "env:",
    "k8s:",
    "vault:",
    "",
    "ENV:UPPERCASE_SCHEME",
  ])("rejects %s", (value) => {
    expect(isValidSecretReference(value)).toBe(false);
  });
});
