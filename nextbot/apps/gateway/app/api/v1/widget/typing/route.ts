import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { WidgetTypingRequestSchema } from "@nextbot/contracts";
import { handleSetWidgetTyping } from "@nextbot/conversations";
import { corsHeaders, corsPreflightResponse } from "../../../../../src/lib/cors.js";
import { requireWidgetSession } from "../../../../../src/lib/widget-auth.js";

/** `POST /api/v1/widget/typing` -> 204 (LLD §5.3). */
export async function POST(request: NextRequest) {
  const session = await requireWidgetSession(request);
  if (session instanceof Response) return session;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(WidgetTypingRequestSchema, body)) {
    return NextResponse.json(
      { type: "about:blank", title: "Invalid typing state.", status: 422 },
      { status: 422, headers: corsHeaders() },
    );
  }

  handleSetWidgetTyping(session, body.state);
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
