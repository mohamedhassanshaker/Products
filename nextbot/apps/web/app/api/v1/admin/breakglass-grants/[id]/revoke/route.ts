import { NextResponse } from "next/server";
import { revokeBreakglassGrant } from "@nextbot/tenancy";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/breakglass-grants/{id}/revoke` (RBAC: security_settings=Write)
 * — Target Architecture Blueprint Phase 20 (BL-52, FR-ADM-09). Lets a tenant admin
 * revoke an active break-glass consent grant early, at any time. Idempotent: revoking
 * an already-revoked grant succeeds and returns the (unchanged) row rather than
 * erroring — see `revokeBreakglassGrant`'s own doc comment.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;
  const { id } = await params;

  try {
    const grant = await revokeBreakglassGrant(guard.ctx, id, guard.session.userId);
    if (!grant) {
      return NextResponse.json({ type: "about:blank", title: "Break-glass grant not found.", status: 404 }, { status: 404 });
    }
    return NextResponse.json({ grant });
  } catch (err) {
    return problemResponse(err);
  }
}
