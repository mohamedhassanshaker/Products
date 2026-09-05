import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { CreateModelProviderRequestSchema } from "@nextbot/contracts";
import { handleCreateProvider, handleListProviders } from "@nextbot/model-gateway";
import { requireApi, problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/model-gateway/providers` (RBAC: agent_platform=Read) — the
 * tenant's own BYO providers plus every platform-registered one (LLD §14.8.7). */
export async function GET() {
  const guard = await requireApi("agent_platform", "Read");
  if (guard instanceof Response) return guard;
  return NextResponse.json({ providers: await handleListProviders(guard.ctx) });
}

/** `POST /api/v1/admin/model-gateway/providers` (RBAC: agent_platform=Write) —
 * FR-AGT-20 provider registration; `apiKeyPlaintext` (if supplied) is vaulted before
 * anything is persisted, never stored in plaintext. */
export async function POST(request: NextRequest) {
  const guard = await requireApi("agent_platform", "Write");
  if (guard instanceof Response) return guard;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(CreateModelProviderRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid model provider payload.", status: 422 }, { status: 422 });
  }
  try {
    const provider = await handleCreateProvider(guard.ctx, body);
    return NextResponse.json({ provider }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
