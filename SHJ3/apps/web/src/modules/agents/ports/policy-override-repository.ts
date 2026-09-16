/**
 * B3 step 7 (Guardrails) — `PolicyOverride` (tenant-scoped, FKs to `Agent` directly, not to
 * a version: a guardrail override is a property of the agent, not a config snapshot) plus
 * a read of `platform.OverridablePolicy`/`platform.Policy` (a real cross-schema reference,
 * "not a Prisma `@relation`... a caller needing the row reads it separately via
 * `getPlatformDb()`" — `PolicyOverride`'s own doc comment, ADR-0011).
 *
 * "Existence in `OverridablePolicies` IS the permission to override" (`OverridablePolicy`'s
 * own doc comment) — `mask_pii_in_transcripts` has no such row, so it can never receive an
 * override; this port surfaces that as data (`isLocked`/`overridable`) rather than the
 * caller having to special-case one policy key by name.
 */

export interface GuardrailPolicyRow {
  readonly policyKey: string;
  readonly title: string;
  readonly detail: string;
  /** `Boolean` | `Threshold` | `Enum` — only `Boolean` policies are exposed by B3 step 7's three toggles. */
  readonly kind: string;
  readonly defaultValueJson: string;
  readonly isLocked: boolean;
}

export interface AgentPolicyOverrideRow {
  readonly id: string;
  readonly policyKey: string;
  /** `Value` | `Disabled`. */
  readonly mode: string;
  readonly valueJson: string | null;
  readonly reason: string;
}

export interface PolicyOverrideRepository {
  /** The platform catalogue for the given keys, each carrying whether it is currently overridable (`isLocked = false` *and* a live `OverridablePolicy` row exists). */
  listGuardrailPolicies(policyKeys: readonly string[]): Promise<readonly GuardrailPolicyRow[]>;

  listOverridesForAgent(agentId: string): Promise<readonly AgentPolicyOverrideRow[]>;

  /** Upserts one override. Rejected by the caller (not this port) before ever reaching here if the policy is locked — `set-guardrail-override.ts` checks `GuardrailPolicyRow.isLocked` first, matching `docs/api.md`'s `409 governance.policy_locked`. */
  setOverride(input: {
    readonly agentId: string;
    readonly policyKey: string;
    readonly mode: "Value" | "Disabled";
    readonly valueJson: string | null;
    readonly reason: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<void>;

  clearOverride(
    agentId: string,
    policyKey: string,
    actorStaffUserId: string,
    now: Date,
  ): Promise<void>;
}
