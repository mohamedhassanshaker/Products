import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { ProvisionTenantForm } from "./ProvisionTenantForm";

/**
 * Provision-a-tenant screen route (NFR-11).
 *
 * `assertOpsPageAllowed()` runs before `ProvisionTenantForm` is constructed — see
 * `src/lib/ops-page-gate.ts` for why every ops page segment must gate itself rather
 * than relying on the root layout alone.
 */
export default async function ProvisionTenantPage() {
  await assertOpsPageAllowed();
  return <ProvisionTenantForm />;
}
