import { assertOpsPageAllowed } from "@/src/lib/ops-page-gate";
import { TenantDetailScreen } from "./TenantDetailScreen";

/**
 * Tenant Detail screen route (NFR-11).
 *
 * `assertOpsPageAllowed()` runs before `params` is awaited and before
 * `TenantDetailScreen` is constructed — see `src/lib/ops-page-gate.ts` for why every ops
 * page segment must gate itself rather than relying on the root layout alone. Gating
 * ahead of the `params` await also keeps a denial from doing any work that varies with
 * the requested tenant id.
 */
export default async function TenantDetailPage({ params }: { params: Promise<{ id: string }> }) {
  await assertOpsPageAllowed();
  const { id } = await params;
  return <TenantDetailScreen tenantId={id} />;
}
