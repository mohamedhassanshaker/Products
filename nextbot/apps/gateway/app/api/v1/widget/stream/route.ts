import type { NextRequest } from "next/server";
import { handleReplaySince, handleSubscribe, type ConversationEvent } from "@nextbot/conversations";
import { corsHeaders, corsPreflightResponse } from "../../../../../src/lib/cors.js";
import { requireWidgetSessionFromStreamRequest } from "../../../../../src/lib/widget-auth.js";

const HEARTBEAT_INTERVAL_MS = 20_000;

/**
 * `GET /api/v1/widget/stream?sinceSequence=<n>` — Server-Sent Events (LLD §5.3).
 * Next.js Route Handlers stream a `ReadableStream` response body natively (the
 * documented rationale for choosing SSE over WebSockets, LLD §5.3), which is what
 * makes this endpoint a plain Route Handler rather than needing a raw `node:http`
 * server.
 *
 * Reconnect semantics: replays every message with `sequence > sinceSequence` first
 * (gap-free per `message.sequence`'s uniqueness/monotonicity guarantee), then forwards
 * every live event published for this conversation until the client disconnects.
 */
export async function GET(request: NextRequest) {
  // `EventSource` (used client-side) cannot set an Authorization header — the
  // session token arrives as a `token` query param here instead (see
  // `requireWidgetSessionFromStreamRequest`'s doc).
  const session = await requireWidgetSessionFromStreamRequest(request);
  if (session instanceof Response) return session;

  const sinceSequenceParam = request.nextUrl.searchParams.get("sinceSequence");
  const sinceSequence = sinceSequenceParam ? Number.parseInt(sinceSequenceParam, 10) : 0;

  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe: (() => void) | undefined;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      };

      try {
        const gap = await handleReplaySince(session, Number.isFinite(sinceSequence) ? sinceSequence : 0);
        for (const message of gap) {
          send("message", { message });
        }
      } catch (err) {
        send("error", { title: "Failed to replay missed messages.", detail: (err as Error).message });
      }

      unsubscribe = handleSubscribe(session, (event: ConversationEvent) => {
        send(event.event, event.data);
      });

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`event: heartbeat\ndata: {}\n\n`));
      }, HEARTBEAT_INTERVAL_MS);

      request.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // already closed — a client abort can race this close.
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders(),
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function OPTIONS() {
  return corsPreflightResponse();
}
