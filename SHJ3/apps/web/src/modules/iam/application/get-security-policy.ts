/** Load the Security tab's current session/lockout policy, seeding the singleton row on first use. */

import type {
  SecurityPolicyRepository,
  SecurityPolicyRow,
} from "../ports/security-policy-repository.js";

export interface GetSecurityPolicyDeps {
  readonly securityPolicy: SecurityPolicyRepository;
}

export class GetSecurityPolicy {
  constructor(private readonly deps: GetSecurityPolicyDeps) {}

  async execute(input: { readonly now: Date }): Promise<SecurityPolicyRow> {
    return this.deps.securityPolicy.ensureTenantConfig(input.now);
  }
}
