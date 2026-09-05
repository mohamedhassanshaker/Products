import { NextResponse } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { IssueApiKeyRequestSchema } from "@nextbot/contracts";
import { handleIssueApiKey, handleListApiKeys } from "@nextbot/iam";
import { getSession, getSessionTenantContext } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

/** `GET/POST /api/v1/admin/service-accounts/{id}/api-keys` (Phase 4, BL-36,
 * FR-SEC-10) — a key's `scopeMatrix` (if any) is validated server-side against
 * the account's own role-derived matrix; the plaintext key is returned only
 * once, from `POST`. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  try {
    return NextResponse.json(await handleListApiKeys(session, id));
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(IssueApiKeyRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid API key payload.", status: 422 }, { status: 422 });
  }
  const ctx = await getSessionTenantContext(session);
  try {
    const result = await handleIssueApiKey(session, id, body);
    await recordAdminAudit(ctx, {
      actorId: session.userId,
      actorLabel: session.userId,
      actionType: "api_key.issue",
      targetType: "ApiKey",
      targetId: result.apiKeyId,
      outcome: "Success",
      details: { serviceAccountUserId: id, name: body.name, scoped: Boolean(body.scopeMatrix) },
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
