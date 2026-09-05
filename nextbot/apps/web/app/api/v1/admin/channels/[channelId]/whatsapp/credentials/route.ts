import { NextResponse, type NextRequest } from "next/server";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { handleRotateSystemUserToken, handleRotateAppSecret } from "@nextbot/channels";
import { requireApi, problemResponse } from "@/src/lib/api-guard";
import { recordAdminAudit } from "@/src/lib/record-admin-audit";

const RotateCredentialRequestSchema = Type.Object({
  which: Type.Union([Type.Literal("systemUserToken"), Type.Literal("appSecret")]),
  value: Type.String({ minLength: 1 }),
});

/** `POST` — credential rotation (§7.2.3: "Rotate", never re-displays the old value).
 * FR-SEC-02: the new plaintext is accepted, vaulted, and never echoed back. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ channelId: string }> }) {
  const guard = await requireApi("channels", "Write");
  if (guard instanceof Response) return guard;
  const { channelId } = await params;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(RotateCredentialRequestSchema, body)) {
    return NextResponse.json({ type: "about:blank", title: "Invalid rotation payload.", status: 422 }, { status: 422 });
  }

  try {
    if (body.which === "systemUserToken") await handleRotateSystemUserToken(guard.ctx, channelId, body.value);
    else await handleRotateAppSecret(guard.ctx, channelId, body.value);

    await recordAdminAudit(guard.ctx, {
      actorId: guard.session.userId,
      actorLabel: guard.session.userId,
      actionType: "whatsapp.credential.rotate",
      targetType: "Channel",
      targetId: channelId,
      outcome: "Success",
      details: { which: body.which },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return problemResponse(err);
  }
}
