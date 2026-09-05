import { describe, expect, it } from "vitest";
import { getProviderTypePolicyForTier, listProviderTypePolicies, setProviderTypePolicy } from "./provider-type-policy.js";

/**
 * Target Architecture Blueprint Phase 2 (BL-33, FR-AGT-26, real Postgres) —
 * `platform_provider_type_policy` ships seeded permissive for every tier (migration
 * `0048`); this proves that seed and the operator-only write path, without ever
 * hardcoding an actual restrictive policy (the spec's own deliberate scope note).
 */
describe("provider-type-policy (FR-AGT-26, real Postgres)", () => {
  it("every plan tier is seeded with every provider type allowed (the shipped-permissive default)", async () => {
    const policies = await listProviderTypePolicies();
    expect(policies.length).toBeGreaterThanOrEqual(3);
    for (const tier of ["Starter", "Growth", "Enterprise"] as const) {
      const policy = await getProviderTypePolicyForTier(tier);
      expect(policy).not.toBeNull();
      expect(policy!.allowedProviderTypes).toEqual(
        expect.arrayContaining(["openai", "anthropic", "openai-compatible", "ollama", "custom"]),
      );
    }
  });

  it("an operator can narrow a tier's allowed provider types, and the change is read back", async () => {
    const narrowed = await setProviderTypePolicy("Starter", ["openai", "anthropic"], "11111111-1111-1111-1111-111111111111");
    expect(narrowed.allowedProviderTypes).toEqual(["openai", "anthropic"]);
    expect(narrowed.updatedByOperatorId).toBe("11111111-1111-1111-1111-111111111111");

    const reread = await getProviderTypePolicyForTier("Starter");
    expect(reread?.allowedProviderTypes).toEqual(["openai", "anthropic"]);

    // Restore the shipped-permissive default so this test doesn't leak state into
    // any other test relying on Starter being unrestricted.
    await setProviderTypePolicy(
      "Starter",
      ["openai", "anthropic", "gemini", "azure-openai", "openai-compatible", "google-vertex", "bedrock", "openrouter", "ollama", "cohere", "mistral", "custom"],
      "11111111-1111-1111-1111-111111111111",
    );
  });
});
