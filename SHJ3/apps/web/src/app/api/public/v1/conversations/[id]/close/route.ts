/** `POST /api/public/v1/conversations/{id}/close` (api.md §4.2). */

import { withCitizenSession } from "../../../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { CloseConversation } from "../../../../../../../modules/conversation/application/close-conversation.js";
import { isPublicChannelKind } from "../../../../../../../modules/conversation/domain/channel-key.js";
import { assertOriginAllowedForChannelKind } from "../../../_lib/origin-check.js";
import { conversationRepository, escalationRepository } from "../../../_lib/composition.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../../../_lib/problem.js";

function instanceFor(id: string): string {
  return `/api/public/v1/conversations/${id}/close`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const { id } = await context.params;

  try {
    return await withCitizenSession(request, async ({ session, traceId }) => {
      try {
        const conversation = await conversationRepository().findById(session.subjectId);
        if (conversation && isPublicChannelKind(conversation.channelKey)) {
          await assertOriginAllowedForChannelKind(request, conversation.channelKey);
        }

        const result = await new CloseConversation({
          conversations: conversationRepository(),
          escalations: escalationRepository(),
        }).execute({ conversationId: id, sessionSubjectId: session.subjectId, now: new Date() });

        return new Response(JSON.stringify({ outcome: result.outcome }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "x-request-id": requestId,
            "x-trace-id": traceId,
          },
        });
      } catch (innerError) {
        return problemResponse(errorToProblem(innerError, traceId, instanceFor(id)), requestId);
      }
    });
  } catch (outerError) {
    return problemResponse(
      errorToProblem(outerError, newFallbackTraceId(), instanceFor(id)),
      requestId,
    );
  }
}
