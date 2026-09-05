import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { SendWidgetMessageRequestSchema } from "@nextbot/contracts";
import { handleSendWidgetMessage } from "@nextbot/conversations";
import { generateAiReply } from "../../../../../src/lib/turn-pipeline-adapter.js";
import { corsHeaders, corsPreflightResponse } from "../../../../../src/lib/cors.js";
import { problemResponse } from "../../../../../src/lib/problem-response.js";
import { requireWidgetSession } from "../../../../../src/lib/widget-auth.js";
import { checkRateLimit } from "../../../../../src/lib/rate-limit.js";
import { rateLimitedResponse } from "../../../../../src/lib/rate-limit-response.js";

/** BE2 (QA fix pass): per-session ceiling — keyed by `conversationId` (not IP)
 * since this endpoint is already authenticated by the widget session JWT; a
 * single hijacked/malicious session flooding sends (each triggering the AI-reply
 * pipeline) is the resource-exhaustion shape worth capping here. */
const MESSAGE_SEND_LIMIT = 30;
const MESSAGE_SEND_WINDOW_SECONDS = 60;

/** `POST /api/v1/widget/messages` (LLD §5.3). `Idempotency-Key` is required per the
 * LLD; this phase's dedup is keyed off the body's `clientMessageId` (see
 * `sendWidgetMessage`'s doc) — the header is validated as present (a client that
 * omits it is not following the documented contract) but is not a second,
 * independently-tracked idempotency store in this phase. */
export async function POST(request: NextRequest) {
  const session = await requireWidgetSession(request);
  if (session instanceof Response) return session;

  const rateLimit = await checkRateLimit(`widget-message:${session.conversationId}`, MESSAGE_SEND_LIMIT, MESSAGE_SEND_WINDOW_SECONDS);
  if (!rateLimit.allowed) return rateLimitedResponse(MESSAGE_SEND_WINDOW_SECONDS);

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json(
      { type: "about:blank", title: "Idempotency-Key header is required.", status: 422 },
      { status: 422, headers: corsHeaders() },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(SendWidgetMessageRequestSchema, body) || body.contentType !== body.payload.contentType) {
    return NextResponse.json(
      { type: "about:blank", title: "That message could not be sent — its content did not match the expected format.", status: 422 },
      { status: 422, headers: corsHeaders() },
    );
  }

  try {
    const result = await handleSendWidgetMessage(session, body, { generateAiReply });
    return NextResponse.json(result, { status: 202, headers: corsHeaders() });
  } catch (err) {
    return problemResponse(err);
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
