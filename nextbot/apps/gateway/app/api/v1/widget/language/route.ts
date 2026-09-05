import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { WidgetLanguageRequestSchema } from "@nextbot/contracts";
import { handleSetWidgetLanguage } from "@nextbot/conversations";
import { corsHeaders, corsPreflightResponse } from "../../../../../src/lib/cors.js";
import { problemResponse } from "../../../../../src/lib/problem-response.js";
import { requireWidgetSession } from "../../../../../src/lib/widget-auth.js";

/** `POST /api/v1/widget/language` -> 204 (LLD §5.3, FR-OC-07). */
export async function POST(request: NextRequest) {
  const session = await requireWidgetSession(request);
  if (session instanceof Response) return session;

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(WidgetLanguageRequestSchema, body)) {
    return NextResponse.json(
      { type: "about:blank", title: "Invalid language selection.", status: 422 },
      { status: 422, headers: corsHeaders() },
    );
  }

  try {
    await handleSetWidgetLanguage(session, body.language);
    return new Response(null, { status: 204, headers: corsHeaders() });
  } catch (err) {
    return problemResponse(err);
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
