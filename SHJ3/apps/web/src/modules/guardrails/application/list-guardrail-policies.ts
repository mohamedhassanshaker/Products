/** Screen 3, "Global policies" tab — the whole real `platform.Policies` catalogue. */

import type {
  GlobalPolicyRow,
  PolicyCatalogueRepository,
} from "../ports/policy-catalogue-repository.js";

export interface ListGuardrailPoliciesResult {
  readonly policies: readonly GlobalPolicyRow[];
}

export class ListGuardrailPolicies {
  constructor(private readonly deps: { readonly policies: PolicyCatalogueRepository }) {}

  async execute(): Promise<ListGuardrailPoliciesResult> {
    const policies = await this.deps.policies.list();
    return { policies };
  }
}
