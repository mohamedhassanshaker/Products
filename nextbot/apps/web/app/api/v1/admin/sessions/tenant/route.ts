import { NextResponse } from "next/server";
import { handleListTenantSessions } from "@nextbot/iam";
import { getSession } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";

/** `GET /api/v1/admin/sessions/tenant` — admin-facing "every active session in
 * this tenant" view (Phase 4, BL-36). `users_roles` Read-gated (checked inside
 * `@nextbot/iam`'s own http layer). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    return NextResponse.json(await handleListTenantSessions(session));
  } catch (err) {
    return problemResponse(err);
  }
}
