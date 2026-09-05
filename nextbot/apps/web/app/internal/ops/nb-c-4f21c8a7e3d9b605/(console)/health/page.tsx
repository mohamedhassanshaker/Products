import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { HealthRollupScreen } from "./HealthRollupScreen";

/**
 * Health screen route (Platform Manager console Phase 3, NFR-11).
 *
 * `assertOpsPageAllowed()` runs before `HealthRollupScreen` is constructed — see
 * `src/lib/ops-page-gate.ts` for why every ops page segment must gate itself rather
 * than relying on the root layout alone (page segments render in parallel with
 * their layouts, so a root-layout-only gate does not stop this page's real
 * component/chunk names from reaching a denied caller's response).
 */
export default async function HealthPage() {
  await assertOpsPageAllowed();
  return <HealthRollupScreen />;
}
