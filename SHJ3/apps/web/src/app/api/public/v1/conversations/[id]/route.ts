/** `GET /api/public/v1/conversations/{id}` (api.md §4.2) — rehydrate the thread on reload, cursor-paginated. */

import { withCitizenSession } from "../../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { GetConversation } from "../../../../../../modules/conversation/application/get-conversation.js";
import { decodeTurnsCursor } from "../../../../../../modules/conversation/domain/turns-cursor.js";
import { assertOriginAllowedForChannelKind } from "../../_lib/origin-check.js";
import { isPublicChannelKind } from "../../../../../../modules/conversation/domain/channel-key.js";
import { conversationRepository, escalationRepository } from "../../_lib/composition.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../../_lib/problem.js";

function instanceFor(id: string): string {
  return `/api/public/v1/conversations/${id}`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const { id } = await context.params;
  const url = new URL(request.url);

  try {
    return await withCitizenSession(request, async ({ session, traceId }) => {
      try {
        const conversation = await conversationRepository().findById(session.subjectId);
        if (conversation && isPublicChannelKind(conversation.channelKey)) {
          await assertOriginAllowedForChannelKind(request, conversation.channelKey);
        }

        const cursorParam = url.searchParams.get("cursor");
        const cursor = cursorParam ? decodeTurnsCursor(cursorParam) : null;
        const limitParam = url.searchParams.get("limit");
        const limit = limitParam ? Number(limitParam) : null;

        const result = await new GetConversation({
          conversations: conversationRepository(),
          escalations: escalationRepository(),
        }).execute({
          conversationId: id,
          sessionSubjectId: session.subjectId,
          cursor,
          limit,
        });

        return new Response(
          JSON.stringify({
            conversationId: result.conversationId,
            outcome: result.outcome,
            data: result.turns.map((turn) => ({
              id: turn.id,
              ordinal: turn.ordinal,
              role: turn.role,
              content: turn.contentMasked,
              contentFormat: turn.contentFormat,
              wasRefused: turn.wasRefused,
              refusalReason: turn.refusalReason,
              createdAt: turn.createdAt.toISOString(),
            })),
            page: {
              nextCursor: result.nextCursor,
              prevCursor: null,
              hasMore: result.hasMore,
              limit: limit ?? 50,
            },
            pendingSlot: result.pendingSlot,
            handoverActive: result.handoverActive,
          }),
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
