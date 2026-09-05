import { NextResponse } from "next/server";
import { exportConfigBundle } from "@/src/lib/config-portability-service";
import { requireApi } from "@/src/lib/api-guard";

/**
 * `GET /api/v1/admin/config-portability/export` (RBAC: security_settings — the same
 * capability every other tenant-wide administrative action in this codebase uses,
 * e.g. `data-policy`/`branding`/`dsr`). Target Architecture Blueprint Phase 19
 * (BL-51, FR-ADM-08). Returns the full versioned bundle document as a downloadable
 * JSON file — never a black-box: the response body IS the bundle, including its own
 * `manifest` an admin can inspect before ever restoring it anywhere.
 */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;

  const bundle = await exportConfigBundle(guard.ctx, guard.session.userId);
  const filename = `nextbot-config-export-${guard.ctx.tenantId}-${Date.now()}.json`;
  return new NextResponse(JSON.stringify(bundle, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
