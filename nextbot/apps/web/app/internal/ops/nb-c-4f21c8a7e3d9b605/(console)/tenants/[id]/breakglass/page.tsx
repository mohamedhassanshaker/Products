import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { BreakglassOpsScreen } from "./BreakglassOpsScreen";

/**
 * Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09) — Break-Glass Access
 * screen for the Platform Manager console. `assertOpsPageAllowed()` mirrors
 * `TenantDetailPage`'s own established gating pattern (see that file's doc comment).
 */
export default async function BreakglassOpsPage({ params }: { params: Promise<{ id: string }> }) {
  await assertOpsPageAllowed();
  const { id } = await params;
  return <BreakglassOpsScreen tenantId={id} />;
}
