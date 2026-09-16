/** `POST /api/public/v1/conversations/{id}/handover` (api.md §4.2). */

import { withCitizenSession } from "../../../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { RequestHandover } from "../../../../../../../modules/conversation/application/request-handover.js";
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
  return `/api/public/v1/conversations/${id}/handover`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const { id } = await context.params;

  let body: unknown = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is legitimate here (api.md names no required fields beyond identity/tenancy).
  }

  try {
    return await withCitizenSession(request, async ({ session, traceId }) => {
      try {
        const conversation = await conversationRepository().findById(session.subjectId);
        if (!conversation || !isPublicChannelKind(conversation.channelKey)) {
          throw new Error("conversation channel kind unrecognised");
        }
        await assertOriginAllowedForChannelKind(request, conversation.channelKey);

        const reasonDetail =
          typeof (body as { reason?: unknown })?.reason === "string"
            ? (body as { reason: string }).reason
            : "Citizen requested a human agent.";

        const result = await new RequestHandover({
          conversations: conversationRepository(),
          escalations: escalationRepository(),
        }).execute({
          conversationId: id,
          sessionSubjectId: session.subjectId,
          channelKind: conversation.channelKey,
          reasonDetail,
          now: new Date(),
        });

        return new Response(JSON.stringify(result), {
          status: 201,
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
