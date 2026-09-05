import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpsertOtelExportConfigRequestSchema } from "@nextbot/contracts";
import { handleGetOtelExportConfig, handleUpdateOtelExportConfig } from "@nextbot/telemetry-export";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/**
 * Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — tenant-scoped, opt-in
 * OTel trace/metric export configuration, gated under `security_settings` (same
 * precedent as the webhooks subscription routes above).
 *
 * `GET /api/v1/admin/telemetry-export/otel` (RBAC: security_settings=Read).
 */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ config: await handleGetOtelExportConfig(guard.ctx) });
}

/** `PUT /api/v1/admin/telemetry-export/otel` (RBAC: security_settings=Write). */
export async function PUT(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpsertOtelExportConfigRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid OTel export config payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ config: await handleUpdateOtelExportConfig(guard.ctx, body) });
  } catch (err) {
    return problemResponse(err);
  }
}
