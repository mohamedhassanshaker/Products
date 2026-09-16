/**
 * Read B3 step 7's guardrail settings for one agent — the platform catalogue merged with
 * whatever overrides this agent already has.
 *
 * `GUARDRAIL_POLICY_KEYS` are the three real policy keys this wave's step 7 renders:
 * `mask_pii_in_transcripts` (permanently locked — no `platform.OverridablePolicies` row ever
 * exists for it, so it can never leave `"Default"`), `grounding_threshold`, and
 * `allow_competitor_discussion` (seeded by a later step of this same wave, not by this file —
 * referenced here only as the literal key B3 step 7's third toggle is wired to).
 *
 * `currentMode: "Default"` means no live `PolicyOverride` row exists for this policy on this
 * agent — the platform default value applies, which is the common case for most
 * (agent, policy) pairs, not an error state.
 */

import type { PolicyOverrideRepository } from "../ports/policy-override-repository.js";

export const GUARDRAIL_POLICY_KEYS = [
  "mask_pii_in_transcripts",
  "grounding_threshold",
  "allow_competitor_discussion",
] as const;

export type GuardrailPolicyKey = (typeof GUARDRAIL_POLICY_KEYS)[number];

export interface GuardrailSettingRow {
  readonly policyKey: string;
  readonly title: string;
  readonly isLocked: boolean;
  /** `"Default"` — no override row exists; the platform default applies. */
  readonly currentMode: "Value" | "Disabled" | "Default";
  readonly valueJson: string | null;
}

export interface GetGuardrailSettingsInput {
  readonly agentId: string;
}

export interface GetGuardrailSettingsResult {
  readonly settings: readonly GuardrailSettingRow[];
}

export interface GetGuardrailSettingsDeps {
  readonly policies: PolicyOverrideRepository;
}

function isOverrideMode(value: string): value is "Value" | "Disabled" {
  return value === "Value" || value === "Disabled";
}

export class GetGuardrailSettings {
  constructor(private readonly deps: GetGuardrailSettingsDeps) {}

  async execute(input: GetGuardrailSettingsInput): Promise<GetGuardrailSettingsResult> {
    const [catalogue, overrides] = await Promise.all([
      this.deps.policies.listGuardrailPolicies(GUARDRAIL_POLICY_KEYS),
      this.deps.policies.listOverridesForAgent(input.agentId),
    ]);

    const overrideByKey = new Map(overrides.map((override) => [override.policyKey, override]));

    const settings = catalogue.map((policy): GuardrailSettingRow => {
      const override = overrideByKey.get(policy.policyKey);
      if (!override) {
        return {
          policyKey: policy.policyKey,
          title: policy.title,
          isLocked: policy.isLocked,
          currentMode: "Default",
          valueJson: null,
        };
      }
      if (!isOverrideMode(override.mode)) {
        throw new Error(
          `PolicyOverride "${override.id}" for agent "${input.agentId}" has an unrecognized mode "${override.mode}".`,
        );
      }
      return {
        policyKey: policy.policyKey,
        title: policy.title,
        isLocked: policy.isLocked,
        currentMode: override.mode,
        valueJson: override.valueJson,
      };
    });

    return { settings };
  }
}
