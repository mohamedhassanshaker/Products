/** `GET /api/public/v1/conversations/{id}/turns/{turnId}/stream` (api.md §4.2/§5.3) — reattach via `Last-Event-ID`. See `_lib/reattach.ts`'s own doc comment for this endpoint's honest scope. */

import { withCitizenSession } from "../../../../../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { isPublicChannelKind } from "../../../../../../../../../modules/conversation/domain/channel-key.js";
import { requireOwnConversation } from "../../../../../../../../../modules/conversation/application/conversation-not-found.js";
import { assertOriginAllowedForChannelKind } from "../../../../../_lib/origin-check.js";
import { reattachResponse } from "../../../../../_lib/reattach.js";
import { conversationRepository } from "../../../../../_lib/composition.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../../../../../_lib/problem.js";

function instanceFor(id: string, turnId: string): string {
  return `/api/public/v1/conversations/${id}/turns/${turnId}/stream`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string; turnId: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const { id, turnId } = await context.params;

  try {
    return await withCitizenSession(request, async ({ session, traceId }) => {
      try {
        requireOwnConversation(session.subjectId, id);
        const conversation = await conversationRepository().findById(session.subjectId);
        if (conversation && isPublicChannelKind(conversation.channelKey)) {
          await assertOriginAllowedForChannelKind(request, conversation.channelKey);
        }

        const lastEventIdHeader = request.headers.get("last-event-id");
        const afterEventId = lastEventIdHeader ? Number(lastEventIdHeader) || 0 : 0;

        return await reattachResponse({ turnId, afterEventId, requestId, traceId });
      } catch (innerError) {
        return problemResponse(
          errorToProblem(innerError, traceId, instanceFor(id, turnId)),
          requestId,
        );
      }
    });
  } catch (outerError) {
    return problemResponse(
      errorToProblem(outerError, newFallbackTraceId(), instanceFor(id, turnId)),
      requestId,
    );
  }
}
