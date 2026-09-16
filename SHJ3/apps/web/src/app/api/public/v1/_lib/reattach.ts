/**
 * Shared reattach response — used both by `turns/route.ts` (a `clientTurnId`
 * dedupe hit) and `turns/[turnId]/stream/route.ts` (an explicit reattach
 * after a dropped connection). api.md §5.3: "Buffered events are kept in
 * Redis for 5 minutes."
 *
 * **Honest scope trim:** this replays whatever has been buffered so far and
 * then closes — it does not hold the connection open to keep streaming a
 * *foreign, still-in-flight* request's later frames as they arrive (that
 * would need a pub/sub fan-out this wave does not build). For the common
 * case — reattaching after the original request already finished — this is
 * a complete, correct replay. For the rarer case of reattaching mid-flight,
 * the client sees a partial replay and a clean close, which its own grammar
 * rule ("a client that sees the connection close without a terminal event
 * treats it as `upstream.unavailable` and may re-attach") already tells it
 * how to handle.
 */

import { turnCoordination } from "./composition.js";

export async function reattachResponse(input: {
  readonly turnId: string;
  readonly afterEventId: number;
  readonly requestId: string;
  readonly traceId: string;
}): Promise<Response> {
  const frames = await turnCoordination().replayFramesAfter(input.turnId, input.afterEventId);
  return new Response(frames.join(""), {
    status: 200,
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
      "x-request-id": input.requestId,
      "x-trace-id": input.traceId,
    },
  });
}
