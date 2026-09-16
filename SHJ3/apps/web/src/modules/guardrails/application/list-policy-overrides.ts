/**
 * Screen 3, "Per-agent overrides" tab — every active `PolicyOverride`, across every agent,
 * READ-ONLY (task brief: this screen never writes a per-agent override; that stays the
 * agent wizard's own step 7, `guardrails-step.tsx`).
 */

import type {
  PolicyOverrideDirectoryRepository,
  PolicyOverrideDirectoryRow,
} from "../ports/policy-override-directory-repository.js";

export interface ListPolicyOverridesResult {
  readonly overrides: readonly PolicyOverrideDirectoryRow[];
}

export class ListPolicyOverrides {
  constructor(private readonly deps: { readonly overrides: PolicyOverrideDirectoryRepository }) {}

  async execute(): Promise<ListPolicyOverridesResult> {
    const overrides = await this.deps.overrides.listActive();
    return { overrides };
  }
}
