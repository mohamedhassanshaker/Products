import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { PlanTiersScreen } from "./PlanTiersScreen";

/**
 * Plan Tiers screen route (Platform Manager console Phase 2, NFR-11).
 *
 * `assertOpsPageAllowed()` runs before `PlanTiersScreen` is constructed — see
 * `src/lib/ops-page-gate.ts` for why every ops page segment must gate itself rather
 * than relying on the root layout alone (page segments render in parallel with
 * their layouts, so a root-layout-only gate does not stop this page's real
 * component/chunk names from reaching a denied caller's response).
 */
export default async function PlanTiersPage() {
  await assertOpsPageAllowed();
  return <PlanTiersScreen />;
}
