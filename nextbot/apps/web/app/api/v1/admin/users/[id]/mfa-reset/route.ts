import { NextResponse } from "next/server";
import { handleResetUserMfa } from "@nextbot/iam";
import { getSession } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";

/**
 * `POST /api/v1/admin/users/{id}/mfa-reset` — QA Defect B2's minimal admin-side
 * "reset this user's MFA" action: clears TOTP enrollment + backup codes so a locked-
 * out user (lost authenticator, no backup codes left) can re-enroll. RBAC (`users_
 * roles`, Write) is enforced inside `handleResetUserMfa` itself, the same convention
 * `/api/v1/admin/roles` uses (both are iam's own module, unlike connectors/tools'
 * composition-root `requireApi` indirection).
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  try {
    await handleResetUserMfa(session, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
