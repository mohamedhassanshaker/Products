import { NextResponse, type NextRequest } from "next/server";
import { Value } from "@sinclair/typebox/value";
import { Tier2DecisionRequestSchema, DomainError } from "@nextbot/contracts";
import { decideTier2 } from "@nextbot/orchestration";
import { insertMessage, publishConversationEvent } from "@nextbot/conversations";
import { createMcpEgressPort } from "../../../../../../../src/lib/mcp-egress.js";
import { corsHeaders, corsPreflightResponse } from "../../../../../../../src/lib/cors.js";
import { requireWidgetSession } from "../../../../../../../src/lib/widget-auth.js";
import { checkRateLimit } from "../../../../../../../src/lib/rate-limit.js";
import { rateLimitedResponse } from "../../../../../../../src/lib/rate-limit-response.js";

const CONFIRM_LIMIT = 20;
const CONFIRM_WINDOW_SECONDS = 60;

/**
 * `POST /api/v1/widget/tool-calls/{id}/confirm` (LLD §6.4, Tier 2). `Idempotency-Key`
 * is mandatory per the LLD (checked at the HTTP layer, layer 1 of §6.3's three) —
 * the CAS-claim in `decideTier2` is the second, independent layer that stops a
 * genuinely concurrent duplicate regardless of the header.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireWidgetSession(request);
  if (session instanceof Response) return session;
  const { id: toolCallId } = await params;

  const rateLimit = await checkRateLimit(`tool-call-confirm:${session.conversationId}`, CONFIRM_LIMIT, CONFIRM_WINDOW_SECONDS);
  if (!rateLimit.allowed) return rateLimitedResponse(CONFIRM_WINDOW_SECONDS);

  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey) {
    return NextResponse.json(
      { type: "about:blank", title: "Idempotency-Key header is required.", status: 422 },
      { status: 422, headers: corsHeaders() },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || !Value.Check(Tier2DecisionRequestSchema, body)) {
    return NextResponse.json(
      { type: "about:blank", title: "That decision could not be processed — its content did not match the expected format.", status: 422 },
      { status: 422, headers: corsHeaders() },
    );
  }

  const ctx = { tenantId: session.tenantId, region: session.region, environment: session.environment };

  try {
    const outcome = await decideTier2(ctx, { egress: createMcpEgressPort(ctx) }, toolCallId, body.decision);

    // Reflect the decision back onto the original Confirmation card in place (LLD
    // §6.4: "the one message payload the system mutates") plus, for Confirm, post
    // the execution result (or failure fallback) as a fresh AI message.
    if (outcome.resultPayload) {
      const resultMessage = await insertMessage(ctx, {
        conversationId: session.conversationId,
        sender: "AI",
        contentType: outcome.resultPayload.contentType,
        payload: outcome.resultPayload as unknown as Record<string, unknown>,
      });
      publishConversationEvent(session.conversationId, {
        event: "message",
        data: {
          message: {
            id: resultMessage.id,
            conversationId: resultMessage.conversationId,
            sequence: resultMessage.sequence,
            sender: resultMessage.sender,
            contentType: resultMessage.contentType,
            payload: resultMessage.payload,
            confidenceScore: resultMessage.confidenceScore,
            createdAt: resultMessage.createdAt.toISOString(),
          },
        },
      });
    }

    return NextResponse.json({ toolCallId, status: outcome.toolCall.status }, { status: 200, headers: corsHeaders() });
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json(
        { type: "about:blank", title: err.message, status: err.httpStatus, code: err.code },
        { status: err.httpStatus, headers: corsHeaders() },
      );
    }
    console.error(err);
    return NextResponse.json({ type: "about:blank", title: "An unexpected error occurred.", status: 500 }, { status: 500, headers: corsHeaders() });
  }
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
