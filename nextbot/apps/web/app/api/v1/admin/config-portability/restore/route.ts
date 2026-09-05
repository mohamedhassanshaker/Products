import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { RestoreConfigBundleRequestSchema } from "@nextbot/contracts";
import { runConfigBundleRestore } from "@/src/lib/config-portability-service";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/config-portability/restore` (RBAC: security_settings=Write).
 * Target Architecture Blueprint Phase 19 (BL-51, FR-ADM-08).
 *
 * `mode: "preview"` performs ZERO writes — it computes and returns the identical
 * per-artifact plan `mode: "confirm"` would execute (new Drafts under an existing
 * identity vs. a brand-new identity, connectors needing manual re-credentialing,
 * name collisions skipped), so an admin can review exactly what a restore will do
 * before ever committing to it (never a silent black-box restore, per this feature's
 * own hard requirement). `mode: "confirm"` performs the real restore.
 *
 * Every created artifact is a genuine new Draft that re-enters the normal promotion
 * gate — this endpoint has no path to Production/Approved for anything it creates.
 */
export async function POST(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(RestoreConfigBundleRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid config-bundle restore request.", status: 422 }, { status: 422 });
  }

  try {
    const outcomes = await runConfigBundleRestore(guard.ctx, body.bundle, guard.session.userId, body.mode === "preview");
    return NextResponse.json({ mode: body.mode, outcomes });
  } catch (err) {
    return problemResponse(err);
  }
}
