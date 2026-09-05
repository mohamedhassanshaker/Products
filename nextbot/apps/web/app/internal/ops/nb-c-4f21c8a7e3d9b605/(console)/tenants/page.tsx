import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { TenantListScreen } from "./TenantListScreen";

/**
 * Tenant List screen route (NFR-11).
 *
 * `assertOpsPageAllowed()` runs before `TenantListScreen` is constructed: page segments
 * render in parallel with their layouts, so the root gate denying does not stop this
 * page from rendering, and a rendered `TenantListScreen` puts its real component and
 * chunk names into a denied caller's response — a direct confirmation that this path is
 * a real route. See `src/lib/ops-page-gate.ts`.
 */
export default async function TenantsPage() {
  await assertOpsPageAllowed();
  return <TenantListScreen />;
}
