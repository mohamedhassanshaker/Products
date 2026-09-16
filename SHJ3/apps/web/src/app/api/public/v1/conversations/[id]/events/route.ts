/**
 * `GET /api/public/v1/conversations/{id}/events` (api.md §4.2) — the SSE
 * side-channel for queue-position/agent-joined events.
 *
 * **Honest scope trim, named per this module's own brief:** no live
 * agent-workspace (B8) exists yet to produce real queue-position/agent-
 * joined events, so this is a real, working SSE connection that opens,
 * authenticates and authorizes exactly like every other endpoint here, then
 * emits only `:heartbeat` comments every 15 seconds (api.md §5.2's own
 * heartbeat cadence) until the client disconnects or a `maxDurationMs` cap is
 * reached — never fabricated event content. Once B8 exists, whatever
 * publishes a real "agent joined"/"queue position changed" fact gets a real
 * event pushed into this same stream with no change to this route's shape.
 */

import { withCitizenSession } from "../../../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { isPublicChannelKind } from "../../../../../../../modules/conversation/domain/channel-key.js";
import { encodeHeartbeatComment } from "../../../../../../../modules/conversation/domain/sse-frame-parser.js";
import { assertOriginAllowedForChannelKind } from "../../../_lib/origin-check.js";
import { conversationRepository } from "../../../_lib/composition.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../../../_lib/problem.js";

const HEARTBEAT_INTERVAL_MS = 15_000;
/** Bounded connection lifetime — a real, if simple, cap on how long one HTTP handler keeps a stream open (matches the honest-trim spirit of this route: no reason to hold a serverless-style handler open forever with nothing real to say). */
const MAX_CONNECTION_MS = 10 * 60_000;

function instanceFor(id: string): string {
  return `/api/public/v1/conversations/${id}/events`;
}

export async function GET(
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
        if (session.subjectId !== id) {
          return problemResponse(
            {
              status: 404,
              code: "conversation.not_found",
              title: "Not Found",
              traceId,
              instance: instanceFor(id),
            },
            requestId,
          );
        }

        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            const encoder = new TextEncoder();
            const heartbeat = setInterval(() => {
              try {
                controller.enqueue(encoder.encode(encodeHeartbeatComment()));
              } catch {
                clearInterval(heartbeat);
              }
            }, HEARTBEAT_INTERVAL_MS);
            const stop = setTimeout(() => {
              clearInterval(heartbeat);
              controller.close();
            }, MAX_CONNECTION_MS);
            request.signal.addEventListener("abort", () => {
              clearInterval(heartbeat);
              clearTimeout(stop);
              controller.close();
            });
          },
        });

        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
            connection: "keep-alive",
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
