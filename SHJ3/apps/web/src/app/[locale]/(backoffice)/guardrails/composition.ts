/**
 * Composition helpers for `/guardrails` (Screen 3) — identical precedent to `governance/
 * composition.ts`/`escalations/composition.ts`: thin, stateless wrappers over
 * `getPlatformDb()`/`getTenantDb()`, constructed fresh per call, the one place in this
 * route allowed to name concrete adapters.
 */
import { PrismaPolicyCatalogueRepository } from "../../../../modules/guardrails/adapters/outbound/sql/prisma-policy-catalogue-repository.js";
import { PrismaPolicyOverrideDirectoryRepository } from "../../../../modules/guardrails/adapters/outbound/sql/prisma-policy-override-directory-repository.js";

export function policyCatalogueRepository(): PrismaPolicyCatalogueRepository {
  return new PrismaPolicyCatalogueRepository();
}

export function policyOverrideDirectoryRepository(): PrismaPolicyOverrideDirectoryRepository {
  return new PrismaPolicyOverrideDirectoryRepository();
}

export function now(): Date {
  return new Date();
}
