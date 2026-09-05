import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { UpsertSiemExportConfigRequestSchema } from "@nextbot/contracts";
import { handleGetSiemExportConfig, handleUpdateSiemExportConfig } from "@nextbot/telemetry-export";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/telemetry-export/siem` (RBAC: security_settings=Read). */
export async function GET() {
  const guard = await requireApi("security_settings", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ config: await handleGetSiemExportConfig(guard.ctx) });
}

/** `PUT /api/v1/admin/telemetry-export/siem` (RBAC: security_settings=Write). */
export async function PUT(request: NextRequest) {
  const guard = await requireApi("security_settings", "Write");
  if (guard instanceof Response) return guard;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpsertSiemExportConfigRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid SIEM export config payload.", status: 422 }, { status: 422 });
  }
  try {
    return NextResponse.json({ config: await handleUpdateSiemExportConfig(guard.ctx, body) });
  } catch (err) {
    return problemResponse(err);
  }
}
