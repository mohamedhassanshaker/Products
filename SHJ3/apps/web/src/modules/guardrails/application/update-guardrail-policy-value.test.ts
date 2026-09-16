import { describe, expect, it } from "vitest";
import type { GlobalPolicyRow } from "../ports/policy-catalogue-repository.js";
import { FakePolicyCatalogueRepository } from "../testing/fakes.js";
import { UpdateGuardrailPolicyValue } from "./update-guardrail-policy-value.js";

const now = new Date("2026-09-10T10:00:00.000Z");

const UNLOCKED: GlobalPolicyRow = {
  policyKey: "grounding_threshold",
  title: "Grounding-confidence refusal threshold",
  detail: "Below this confidence the assistant withholds an answer.",
  kind: "Threshold",
  defaultValueJson: '{"value":0.6}',
  floorValueJson: null,
  isLocked: false,
  appliesTo: "Runtime",
  updatedAt: new Date("2026-09-09T00:00:00.000Z"),
};

const LOCKED = {
  ...UNLOCKED,
  policyKey: "mask_pii_in_transcripts",
  title: "Mask PII in transcripts",
  kind: "Boolean",
  defaultValueJson: '{"value":true}',
  isLocked: true,
  appliesTo: "Storage",
};

describe("UpdateGuardrailPolicyValue", () => {
  it("updates an unlocked policy's real defaultValueJson", async () => {
    const policies = new FakePolicyCatalogueRepository([UNLOCKED]);
    const result = await new UpdateGuardrailPolicyValue({ policies }).execute({
      policyKey: UNLOCKED.policyKey,
      defaultValueJson: '{"value":0.75}',
      now,
    });

    expect(result).toEqual({ ok: true });
    const stored = await policies.findByKey(UNLOCKED.policyKey);
    expect(stored?.defaultValueJson).toBe('{"value":0.75}');
    expect(stored?.updatedAt).toEqual(now);
  });

  it("refuses a locked policy server-side — matching the real DB's own refusal, called directly with no UI involved", async () => {
    const policies = new FakePolicyCatalogueRepository([LOCKED]);
    const result = await new UpdateGuardrailPolicyValue({ policies }).execute({
      policyKey: LOCKED.policyKey,
      defaultValueJson: '{"value":false}',
      now,
    });

    expect(result).toEqual({ ok: false, reason: "policy_locked" });
    const stored = await policies.findByKey(LOCKED.policyKey);
    // Unchanged — the write never happened.
    expect(stored?.defaultValueJson).toBe('{"value":true}');
  });

  it("refuses an unknown policy key", async () => {
    const policies = new FakePolicyCatalogueRepository([UNLOCKED]);
    const result = await new UpdateGuardrailPolicyValue({ policies }).execute({
      policyKey: "not_a_real_policy",
      defaultValueJson: '{"value":true}',
      now,
    });

    expect(result).toEqual({ ok: false, reason: "policy_not_found" });
  });

  it("refuses a bare scalar (or any non-object/array JSON) before ever reaching the repository — matching CK_Policies_defaultValueJson_isJson", async () => {
    const policies = new FakePolicyCatalogueRepository([UNLOCKED]);

    const result = await new UpdateGuardrailPolicyValue({ policies }).execute({
      policyKey: UNLOCKED.policyKey,
      defaultValueJson: "0.6",
      now,
    });

    expect(result).toEqual({ ok: false, reason: "invalid_value" });
    const stored = await policies.findByKey(UNLOCKED.policyKey);
    expect(stored?.defaultValueJson).toBe(UNLOCKED.defaultValueJson);
  });
});
