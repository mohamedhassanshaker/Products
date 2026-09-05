import { NextResponse } from "next/server";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { handleListSsoGroupMappings, handleUpsertSsoGroupMapping } from "@nextbot/iam";
import { getSession } from "@/src/lib/session";
import { problemResponse } from "@/src/lib/api-guard";

const UpsertMappingSchema = Type.Object({
  externalGroup: Type.String({ minLength: 1, maxLength: 200 }),
  roleId: Type.String({ format: "uuid" }),
});

/** `GET/POST /api/v1/admin/sso/group-mappings` — IdP group → role mapping
 * (Phase 4, BL-36; `sso_group_mapping` was schema-ready since Phase 2, wired up
 * this phase). */
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  try {
    return NextResponse.json(await handleListSsoGroupMappings(session));
  } catch (err) {
    return problemResponse(err);
  }
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ type: "about:blank", title: "Unauthorized", status: 401 }, { status: 401 });
  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(UpsertMappingSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid group-mapping payload.", status: 422 }, { status: 422 });
  }
  try {
    await handleUpsertSsoGroupMapping(session, body);
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (err) {
    return problemResponse(err);
  }
}
