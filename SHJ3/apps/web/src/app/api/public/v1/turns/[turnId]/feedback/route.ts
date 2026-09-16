/** `PUT`/`DELETE /api/public/v1/turns/{turnId}/feedback` (api.md §4.2). */

import { withCitizenSession } from "../../../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { ConversationNotFoundError } from "../../../../../../../modules/conversation/application/conversation-not-found.js";
import { SetFeedback } from "../../../../../../../modules/conversation/application/set-feedback.js";
import { isPublicChannelKind } from "../../../../../../../modules/conversation/domain/channel-key.js";
import { assertOriginAllowedForChannelKind } from "../../../_lib/origin-check.js";
import {
  conversationRepository,
  feedbackRepository,
  turnCoordination,
} from "../../../_lib/composition.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../../../_lib/problem.js";

function instanceFor(turnId: string): string {
  return `/api/public/v1/turns/${turnId}/feedback`;
}

/** Shared by PUT/DELETE: confirms `turnId` belongs to the caller's own conversation and runs the origin check against that conversation's channel — a citizen session must not rate a turn from a conversation it does not own. */
async function assertOwnsTurn(
  request: Request,
  sessionSubjectId: string,
  turnId: string,
): Promise<void> {
  const conversationId = await conversationRepository().findTurnConversationId(turnId);
  if (!conversationId || conversationId !== sessionSubjectId) throw new ConversationNotFoundError();

  const conversation = await conversationRepository().findById(conversationId);
  if (conversation && isPublicChannelKind(conversation.channelKey)) {
    await assertOriginAllowedForChannelKind(request, conversation.channelKey);
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ turnId: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const { turnId } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problemResponse(
      {
        status: 400,
        code: "request.malformed_body",
        title: "Malformed Body",
        traceId: newFallbackTraceId(),
        instance: instanceFor(turnId),
      },
      requestId,
    );
  }

  try {
    return await withCitizenSession(request, async ({ session, traceId }) => {
      try {
        await assertOwnsTurn(request, session.subjectId, turnId);

        const rating = (body as { rating?: unknown })?.rating;
        const feedback = await new SetFeedback({
          feedback: feedbackRepository(),
          coordination: turnCoordination(),
        }).execute({ turnId, rating: typeof rating === "string" ? rating : "", now: new Date() });

        return new Response(
          JSON.stringify({ turnId: feedback.turnId, rating: feedback.rating.toLowerCase() }),
          {
            status: 200,
            headers: {
              "content-type": "application/json",
              "x-request-id": requestId,
              "x-trace-id": traceId,
            },
          },
        );
      } catch (innerError) {
        return problemResponse(errorToProblem(innerError, traceId, instanceFor(turnId)), requestId);
      }
    });
  } catch (outerError) {
    return problemResponse(
      errorToProblem(outerError, newFallbackTraceId(), instanceFor(turnId)),
      requestId,
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ turnId: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const { turnId } = await context.params;

  try {
    return await withCitizenSession(request, async ({ session, traceId }) => {
      try {
        await assertOwnsTurn(request, session.subjectId, turnId);
        await new SetFeedback({
          feedback: feedbackRepository(),
          coordination: turnCoordination(),
        }).remove(turnId);
        return new Response(null, {
          status: 204,
          headers: { "x-request-id": requestId, "x-trace-id": traceId },
        });
      } catch (innerError) {
        return problemResponse(errorToProblem(innerError, traceId, instanceFor(turnId)), requestId);
      }
    });
  } catch (outerError) {
    return problemResponse(
      errorToProblem(outerError, newFallbackTraceId(), instanceFor(turnId)),
      requestId,
    );
  }
}
