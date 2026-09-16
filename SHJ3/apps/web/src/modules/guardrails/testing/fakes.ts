/** In-memory fakes for every `guardrails` port — same convention as `governance/testing/
 *  fakes.ts`: constructor-seeded state, every real invariant the real DB enforces
 *  (specifically: a locked policy has no `OverridablePolicies` row and refuses a write)
 *  reachable without a database. */

import type {
  GlobalPolicyRow,
  PolicyCatalogueRepository,
  UpdateGlobalPolicyValueResult,
} from "../ports/policy-catalogue-repository.js";
import type {
  PolicyOverrideDirectoryRepository,
  PolicyOverrideDirectoryRow,
} from "../ports/policy-override-directory-repository.js";

export class FakePolicyCatalogueRepository implements PolicyCatalogueRepository {
  private readonly rows = new Map<string, GlobalPolicyRow>();

  constructor(seed: readonly GlobalPolicyRow[] = []) {
    for (const row of seed) this.rows.set(row.policyKey, row);
  }

  async list(): Promise<readonly GlobalPolicyRow[]> {
    return [...this.rows.values()].sort((a, b) => a.policyKey.localeCompare(b.policyKey));
  }

  async findByKey(policyKey: string): Promise<GlobalPolicyRow | null> {
    return this.rows.get(policyKey) ?? null;
  }

  async updateDefaultValue(input: {
    readonly policyKey: string;
    readonly defaultValueJson: string;
    readonly now: Date;
  }): Promise<UpdateGlobalPolicyValueResult> {
    const existing = this.rows.get(input.policyKey);
    if (!existing) return { ok: false, reason: "policy_not_found" };
    // Mirrors the real repository: re-checked against the row's OWN current `isLocked`
    // state at write time, not a value the caller might be holding stale.
    if (existing.isLocked) return { ok: false, reason: "policy_locked" };

    this.rows.set(input.policyKey, {
      ...existing,
      defaultValueJson: input.defaultValueJson,
      updatedAt: input.now,
    });
    return { ok: true };
  }
}

export class FakePolicyOverrideDirectoryRepository implements PolicyOverrideDirectoryRepository {
  constructor(private readonly rows: readonly PolicyOverrideDirectoryRow[] = []) {}

  async listActive(): Promise<readonly PolicyOverrideDirectoryRow[]> {
    return this.rows;
  }
}
