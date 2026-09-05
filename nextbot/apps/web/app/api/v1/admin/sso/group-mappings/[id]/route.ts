import { NextResponse } from "next/server";
import { handleDeleteSsoGroupMapping } from "@nextbot/iam";
import { getSession } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";

/** `DELETE /api/v1/admin/sso/group-mappings/{id}` (Phase 4, BL-36). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const { id } = await params;
  try {
    await handleDeleteSsoGroupMapping(session, id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
