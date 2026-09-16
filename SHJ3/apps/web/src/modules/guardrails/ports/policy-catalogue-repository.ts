/**
 * Screen 3 (Guardrails & policies), "Global policies" — the platform-wide `platform.
 * Policies`/`platform.OverridablePolicies` catalogue, read and (for unlocked rows) written.
 *
 * `isLocked` here is always derived from the real `OverridablePolicies` membership, never
 * from a cached `Policies.isLocked` column read in isolation — "existence in
 * `OverridablePolicies` IS the permission to override" (`OverridablePolicy`'s own doc
 * comment) is the real, DB-trigger-maintained ground truth (`TR_Policies_syncOverridable`),
 * matching `PrismaPolicyOverrideRepository.listGuardrailPolicies`'s own established
 * precedent (`modules/agents/adapters/outbound/sql/prisma-policy-override-repository.ts`)
 * rather than inventing a second way to answer the same question.
 */

export interface GlobalPolicyRow {
  readonly policyKey: string;
  readonly title: string;
  readonly detail: string;
  /** `Boolean` | `Threshold` | `Enum` (`CK_Policies_kind`). */
  readonly kind: string;
  readonly defaultValueJson: string;
  /** The strictest value a per-agent override may take (`TR_PolicyOverrides_respectFloor`). `null` when this policy has no floor. */
  readonly floorValueJson: string | null;
  /** Derived from real `OverridablePolicies` membership, not a bare column read — see this file's own doc comment. */
  readonly isLocked: boolean;
  /** `Runtime` | `Storage` (`CK_Policies_appliesTo`). */
  readonly appliesTo: string;
  readonly updatedAt: Date;
}

/**
 * `"policy_locked"` is the real, server-side refusal this screen's own brief demands — it
 * is checked against the live `OverridablePolicies` membership at write time, not against a
 * value already read and possibly stale, so it stays correct even if a concurrent request
 * just flipped this exact policy's lock. `"policy_not_found"` covers a `policyKey` that
 * does not exist at all (a stale UI, a hand-crafted direct call) — distinct from "locked"
 * so a caller can tell the two apart rather than treating every refusal as "locked."
 */
export type UpdateGlobalPolicyValueResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "policy_locked" | "policy_not_found" };

export interface PolicyCatalogueRepository {
  list(): Promise<readonly GlobalPolicyRow[]>;
  findByKey(policyKey: string): Promise<GlobalPolicyRow | null>;

  /**
   * Updates an unlocked policy's real `defaultValueJson`. Refuses server-side — not merely
   * hidden by the UI — the moment `policyKey` is currently locked (no live
   * `OverridablePolicies` row), re-checked at write time rather than trusted from an
   * earlier read. This is the exact structural guarantee the task brief asks this screen to
   * prove: "attempting to toggle them does nothing" (`001_constraints.sql`'s own §1.4
   * comment), true here even when this method is called directly, bypassing the UI
   * entirely.
   */
  updateDefaultValue(input: {
    readonly policyKey: string;
    readonly defaultValueJson: string;
    readonly now: Date;
  }): Promise<UpdateGlobalPolicyValueResult>;
}
