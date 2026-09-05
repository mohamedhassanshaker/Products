import { describe, expect, it } from "vitest";
import type { ScopeDescriptor } from "@nextbot/contracts";
import { GuardrailLoosenedError } from "@nextbot/contracts";
import { assertTightensOnly } from "./guardrail-tightening.js";

function tenantFloor(overrides: Partial<ScopeDescriptor> = {}): ScopeDescriptor {
  return { origin: "TenantPolicy", originId: "tenant", originLabel: "Tenant default policy", ...overrides };
}

function proposed(overrides: Partial<ScopeDescriptor> = {}): ScopeDescriptor {
  return { origin: "AgentVersion", originId: "agent-v1", originLabel: "Agent v1", ...overrides };
}

/**
 * Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-14, LLD §14.5.6) —
 * `assertTightensOnly`'s own unit suite. Every scenario is a genuine adversarial
 * "try to loosen this dimension" attempt, not merely a happy-path smoke test —
 * this is the FR-AGT-14 enforcement mechanism itself, exercised directly.
 */
describe("assertTightensOnly — FR-AGT-14 guardrail tightening-only invariant", () => {
  it("never rejects a version that declares nothing beyond the tenant floor (every dimension stays at ⊤)", () => {
    expect(() => assertTightensOnly(tenantFloor(), proposed())).not.toThrow();
  });

  it("allows a version that TIGHTENS maskingFloor relative to the tenant floor", () => {
    expect(() =>
      assertTightensOnly(tenantFloor({ maskingFloor: { Transcript: "PartialMask" } }), proposed({ maskingFloor: { Transcript: "FullMask" } })),
    ).not.toThrow();
  });

  it("rejects a version that LOOSENS maskingFloor.Transcript from FullMask (tenant floor) to Show — the FR-AGT-14 worked example", () => {
    let thrown: unknown;
    try {
      assertTightensOnly(tenantFloor({ maskingFloor: { Transcript: "FullMask" } }), proposed({ maskingFloor: { Transcript: "Show" } }));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GuardrailLoosenedError);
    const err = thrown as InstanceType<typeof GuardrailLoosenedError>;
    expect(err.code).toBe("GUARDRAIL_LOOSENED");
    expect(err.httpStatus).toBe(422);
    expect(err.path).toBe("maskingFloor.Transcript");
    expect(err.fields?.[0]).toMatchObject({ path: "maskingFloor.Transcript", code: "GUARDRAIL_LOOSENED" });
  });

  it("rejects loosening one context while another context in the same maskingFloor is fine (names the exact offending context)", () => {
    let thrown: unknown;
    try {
      assertTightensOnly(
        tenantFloor({ maskingFloor: { Transcript: "FullMask", Export: "PartialMask" } }),
        proposed({ maskingFloor: { Transcript: "Redact", Export: "Show" } }),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GuardrailLoosenedError);
    expect((thrown as InstanceType<typeof GuardrailLoosenedError>).path).toBe("maskingFloor.Export");
  });

  it("rejects a version declaring a LOWER trustLevel restriction than the tenant floor (trustLevel's meet is 'lower wins')", () => {
    // Tenant floor already narrowed to SemiTrusted; a version trying to claim
    // the stronger "Trusted" (i.e. loosen the restriction) must be rejected.
    expect(() => assertTightensOnly(tenantFloor({ trustLevel: "SemiTrusted" }), proposed({ trustLevel: "Trusted" }))).toThrow(GuardrailLoosenedError);
  });

  it("allows a version declaring a STRICTER trustLevel than the tenant floor", () => {
    expect(() => assertTightensOnly(tenantFloor({ trustLevel: "SemiTrusted" }), proposed({ trustLevel: "Untrusted" }))).not.toThrow();
  });

  it("rejects a version disabling refuseWhenUngrounded when the tenant floor requires it (meet is OR — deny-shaped)", () => {
    expect(() => assertTightensOnly(tenantFloor({ refuseWhenUngrounded: true }), proposed({ refuseWhenUngrounded: false }))).toThrow(GuardrailLoosenedError);
  });

  it("rejects a version declaring FEWER minCitations than the tenant floor requires (meet is max)", () => {
    expect(() => assertTightensOnly(tenantFloor({ minCitations: 3 }), proposed({ minCitations: 1 }))).toThrow(GuardrailLoosenedError);
  });

  it("allows a version declaring MORE minCitations than the tenant floor requires", () => {
    expect(() => assertTightensOnly(tenantFloor({ minCitations: 1 }), proposed({ minCitations: 3 }))).not.toThrow();
  });

  it("rejects a version widening channelTypes beyond a bounded tenant floor (bounded-top semantics)", () => {
    expect(() =>
      assertTightensOnly(tenantFloor({ channelTypes: ["WebWidget"] }), proposed({ channelTypes: ["WebWidget", "WhatsApp"] })),
    ).toThrow(GuardrailLoosenedError);
  });

  it("allows a version narrowing channelTypes to a subset of the tenant floor", () => {
    expect(() => assertTightensOnly(tenantFloor({ channelTypes: ["WebWidget", "WhatsApp"] }), proposed({ channelTypes: ["WebWidget"] }))).not.toThrow();
  });
});
