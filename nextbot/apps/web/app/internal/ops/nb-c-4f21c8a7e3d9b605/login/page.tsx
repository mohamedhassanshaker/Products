import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { OpsLoginForm } from "./OpsLoginForm";

/**
 * Operator login screen route (NFR-11). Deliberately outside the `(console)` route
 * group, so it renders for a network-allowed caller who has no session yet instead of
 * being redirected to itself.
 *
 * `assertOpsPageAllowed()` runs before `OpsLoginForm` is constructed — page segments
 * render in parallel with their layouts, so without this the login form's real
 * component/chunk names appeared in the response of a caller the root gate had already
 * denied, confirming that `/internal/ops/login` is a real route. See
 * `src/lib/ops-page-gate.ts`.
 */
export default async function OpsLoginPage() {
  await assertOpsPageAllowed();
  return <OpsLoginForm />;
}
