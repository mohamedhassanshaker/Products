/**
 * `POST /api/public/v1/conversations/{id}/turns` (api.md §4.3) — the
 * citizen-facing turn pipeline entry point. `shj3-web` never implements the
 * pipeline itself: this route validates, resolves the bound agent, opens
 * `POST /v1/conversations/{id}/turns` on `shj3-ai` via `postAiTurnStream`,
 * and pipes the SSE stream through **event for event, as it arrives** —
 * never buffering the whole thing before writing (api.md §4.3, and the
 * top-level brief's own instruction to build this so today's incremental-
 * streaming landing on the AI side is a free timing improvement with no
 * proxy change needed).
 *
 * `Accept: application/json` takes the buffered-envelope branch instead
 * (api.md §4.3: "Provided for the WhatsApp path and for tests").
 */

import { withCitizenSession } from "../../../../../../../modules/iam/adapters/inbound/public-request-context.js";
import { newUlid } from "../../../../../../../modules/platform/adapters/outbound/sql/ulid.js";
import {
  createCitizenScopedAiClient,
  postAiTurnStream,
} from "../../../../../../../modules/platform/adapters/outbound/ai-client.js";
import { isPublicChannelKind } from "../../../../../../../modules/conversation/domain/channel-key.js";
import { filterEventForCitizen } from "../../../../../../../modules/conversation/domain/citizen-event-filter.js";
import {
  encodeSseFrame,
  SseFrameParser,
} from "../../../../../../../modules/conversation/domain/sse-frame-parser.js";
import {
  PostTurn,
  ValidationFailedError,
} from "../../../../../../../modules/conversation/application/post-turn.js";
import { ConversationNotFoundError } from "../../../../../../../modules/conversation/application/conversation-not-found.js";
import { assertOriginAllowedForChannelKind } from "../../../_lib/origin-check.js";
import { reattachResponse } from "../../../_lib/reattach.js";
import {
  conversationRepository,
  escalationRepository,
  turnCoordination,
  widgetChannelRepository,
} from "../../../_lib/composition.js";
import {
  errorToProblem,
  newFallbackTraceId,
  newRequestId,
  problemResponse,
} from "../../../_lib/problem.js";

function instanceFor(id: string): string {
  return `/api/public/v1/conversations/${id}/turns`;
}

interface TurnEnvelopeLike {
  readonly [key: string]: unknown;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const requestId = newRequestId();
  const { id } = await context.params;

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
        instance: instanceFor(id),
      },
      requestId,
    );
  }
  const input = body as {
    content?: unknown;
    inputMode?: unknown;
    chipId?: unknown;
    clientTurnId?: unknown;
  };

  try {
    return await withCitizenSession(request, async ({ session, traceId }) => {
      const postTurn = new PostTurn({
        conversations: conversationRepository(),
        escalations: escalationRepository(),
        widgetChannels: widgetChannelRepository(),
        coordination: turnCoordination(),
      });

      try {
        const conversation = await conversationRepository().findById(session.subjectId);
        if (!conversation || !isPublicChannelKind(conversation.channelKey)) {
          throw new ConversationNotFoundError();
        }
        await assertOriginAllowedForChannelKind(request, conversation.channelKey);

        const prepared = await postTurn.prepare({
          conversationId: id,
          sessionSubjectId: session.subjectId,
          channelKind: conversation.channelKey,
          content: input.content,
          inputMode: input.inputMode,
          chipId: input.chipId,
          clientTurnId: input.clientTurnId,
          // Minted here, not inside `PostTurn` — see that use case's own doc
          // comment on why id generation is an app-layer/adapter concern.
          newTurnId: newUlid(),
          now: new Date(),
        });

        if (prepared.kind === "reattach") {
          return reattachResponse({ turnId: prepared.turnId, afterEventId: 0, requestId, traceId });
        }

        const acceptHeader = request.headers.get("accept") ?? "";
        const wantsJson =
          acceptHeader.includes("application/json") && !acceptHeader.includes("text/event-stream");

        const aiBody = {
          turnId: prepared.turnId,
          content: input.content,
          channel: prepared.channel,
          locale: conversation.localeCode,
          agentBinding: { agentId: prepared.agentId },
          diagnostics: true,
        };

        if (wantsJson) {
          try {
            const envelope = await createCitizenScopedAiClient(
              session.subjectId,
            ).post<TurnEnvelopeLike>(`/conversations/${id}/turns`, aiBody);
            return new Response(JSON.stringify(filterEventForCitizen(envelope)), {
              status: 200,
              headers: {
                "content-type": "application/json",
                "x-request-id": requestId,
                "x-trace-id": traceId,
              },
            });
          } finally {
            await postTurn.releaseLock(id);
          }
        }

        const upstream = await postAiTurnStream({
          path: `/conversations/${id}/turns`,
          body: aiBody,
          citizenSubjectId: session.subjectId,
        });

        const upstreamBody = upstream.body;
        if (!upstreamBody) {
          await postTurn.releaseLock(id);
          throw new Error("shj3-ai returned no stream body");
        }

        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            const reader = upstreamBody.getReader();
            const decoder = new TextDecoder();
            const encoder = new TextEncoder();
            const parser = new SseFrameParser();
            try {
              for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                const frames = parser.push(decoder.decode(value, { stream: true }));
                for (const frame of frames) {
                  let filteredData = frame.data;
                  try {
                    filteredData = JSON.stringify(filterEventForCitizen(JSON.parse(frame.data)));
                  } catch {
                    // Not JSON (a rare malformed frame) — forward the raw data untouched
                    // rather than dropping the frame silently (grammar rule 1: the stream
                    // must not go silent).
                  }
                  const encoded = encodeSseFrame({
                    id: frame.id,
                    event: frame.event,
                    data: filteredData,
                  });
                  await turnCoordination().bufferFrame(prepared.turnId, encoded);
                  controller.enqueue(encoder.encode(encoded));
                }
              }
            } catch (streamError) {
              console.error("[public-v1/turns] stream proxy failed", {
                traceId,
                error: streamError,
              });
            } finally {
              await postTurn.releaseLock(id);
              controller.close();
            }
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
        if (innerError instanceof ValidationFailedError) {
          return problemResponse(
            {
              status: 422,
              code: "validation.failed",
              title: "Request Validation Failed",
              detail: `${innerError.errors.length} field(s) failed validation.`,
              traceId,
              instance: instanceFor(id),
              errors: innerError.errors,
            },
            requestId,
          );
        }
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
