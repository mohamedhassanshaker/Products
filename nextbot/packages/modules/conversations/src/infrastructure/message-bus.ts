import Redis from "ioredis";
import type { MessageDto } from "@nextbot/contracts";

/**
 * Cross-process pub-sub fan-out for the widget's SSE stream (LLD §5.3).
 *
 * **QA fix (D3, investigation + real fix)**: this module previously used a plain
 * `node:events` `EventEmitter`, which only fans out to subscribers registered
 * *within the same OS process*. QA found "Agent joined"/human-agent-message events
 * correctly persisted to Postgres but never delivered over an already-open widget
 * tab's live SSE connection. Root cause (confirmed, not a dev-mode artifact):
 * `apps/web` (Control Plane — the Admin Console's claim/message/return-to-bot/
 * decision routes) and `apps/gateway` (Gateway Plane — the only process hosting the
 * widget's `/api/v1/widget/stream` SSE route) are **two separate Next.js server
 * processes on two separate ports**, in both `next dev` and `next start`/production
 * builds alike — publishing from `apps/web`'s process could never reach a
 * subscriber's callback living in `apps/gateway`'s process's own `EventEmitter`
 * instance, regardless of build mode. This is why the Admin Console itself always
 * showed the message correctly (it re-fetches over its own polling `GET`, not this
 * bus) while a live customer widget tab never got the push.
 *
 * Fixed by backing this module with real Redis pub/sub (already provisioned for
 * `apps/gateway`/`apps/web`'s own rate limiter — see `src/lib/rate-limit.ts` in
 * either app; same `NEXTBOT_REDIS_URL`/`NEXTBOT_REDIS_TEST_URL` convention, nothing
 * new to stand up) — this is exactly the module's own previously-disclosed follow-up
 * ("swap this module's internals for a Redis pub-sub channel... without changing any
 * caller's signature"), just discovered to be needed *today* (the two-Plane split is
 * real now, not only a future horizontal-scaling concern). `publishConversationEvent`
 * publishes to a Redis channel; `subscribeToConversation` maintains one shared Redis
 * subscription per process and fans incoming messages out to local in-process
 * callbacks (so multiple SSE connections to the same conversation on the same
 * process still share a single Redis subscription).
 */

export type ConversationEvent =
  | { event: "message"; data: { message: MessageDto } }
  | { event: "typing"; data: { actor: "ai" | "human"; state: "start" | "stop" } }
  | {
      event: "conversation";
      /** Phase 16 (BL-09) addition: `escalation` is present only while `status ===
       * "Escalated"` — drives the widget's A.2.11 Human Handoff Notification wait
       * indicator (queue name + best-effort position estimate) and is cleared (by
       * simply omitting the field) once an agent claims/returns the conversation, at
       * which point the transition itself is communicated via an ordinary System
       * `message` event instead (the exact-copy system messages FR-ESC-02/04 require). */
      data: { status: string; escalation?: { queueName: string; positionEstimate?: number } };
    };

function topicFor(conversationId: string): string {
  return `conversation:${conversationId}`;
}

function getRedisUrl(): string {
  const isTest = process.env.NEXTBOT_DB_ENV === "test";
  return (isTest ? process.env.NEXTBOT_REDIS_TEST_URL : process.env.NEXTBOT_REDIS_URL) ?? "redis://localhost:6379";
}

let publisherClient: Redis | undefined;
function getPublisher(): Redis {
  if (!publisherClient) {
    publisherClient = new Redis(getRedisUrl(), { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
    publisherClient.on("error", (err) => {
      // Never let a Redis client-level error event crash the process (ioredis
      // throws if an "error" listener is missing) — the actual failure handling for
      // a publish attempt lives in `publishConversationEvent`'s own catch below.
      console.error("NextBot conversations: Redis publisher client error", err);
    });
  }
  return publisherClient;
}

let subscriberClient: Redis | undefined;
// One `Set` of local callbacks per topic — a single physical Redis subscription is
// shared by every in-process SSE connection subscribed to the same conversation.
const localHandlersByTopic = new Map<string, Set<(event: ConversationEvent) => void>>();

function getSubscriber(): Redis {
  if (!subscriberClient) {
    subscriberClient = new Redis(getRedisUrl(), { lazyConnect: true, maxRetriesPerRequest: 1, connectTimeout: 2000 });
    subscriberClient.on("error", (err) => {
      console.error("NextBot conversations: Redis subscriber client error", err);
    });
    subscriberClient.on("message", (channel: string, message: string) => {
      const handlers = localHandlersByTopic.get(channel);
      if (!handlers || handlers.size === 0) return;
      let event: ConversationEvent;
      try {
        event = JSON.parse(message) as ConversationEvent;
      } catch (err) {
        console.error("NextBot conversations: dropped an unparseable conversation event from Redis", err);
        return;
      }
      for (const handler of handlers) handler(event);
    });
  }
  return subscriberClient;
}

/**
 * Publishes an event to every current subscriber of `conversationId`, in this
 * process or any other. Fails safe: a Redis outage/publish error is logged and
 * swallowed, never thrown into the caller — the message itself is already durably
 * persisted by the caller before this runs, so a missed live push degrades to "the
 * client catches up on its next reconnect/replay-since-sequence", not data loss.
 */
export function publishConversationEvent(conversationId: string, event: ConversationEvent): void {
  const topic = topicFor(conversationId);
  getPublisher()
    .publish(topic, JSON.stringify(event))
    .catch((err: unknown) => {
      console.error(`NextBot conversations: failed to publish a conversation event for "${topic}", dropping it`, err);
    });
}

/** Subscribes to every event published for `conversationId` (from this process or
 * any other) until `unsubscribe()` is called. Returns the unsubscribe function
 * directly (no separate handle object) so callers can register it with an
 * abort/cleanup hook trivially. */
export function subscribeToConversation(conversationId: string, onEvent: (event: ConversationEvent) => void): () => void {
  const topic = topicFor(conversationId);
  const redis = getSubscriber();
  let handlers = localHandlersByTopic.get(topic);
  if (!handlers) {
    handlers = new Set();
    localHandlersByTopic.set(topic, handlers);
    redis.subscribe(topic).catch((err: unknown) => {
      console.error(`NextBot conversations: failed to subscribe to Redis topic "${topic}"`, err);
    });
  }
  handlers.add(onEvent);

  return () => {
    handlers?.delete(onEvent);
    if (handlers && handlers.size === 0) {
      localHandlersByTopic.delete(topic);
      redis.unsubscribe(topic).catch(() => {
        // Best-effort only — an unsubscribe failure just means a now-orphaned Redis
        // subscription with zero local handlers, which is inert (no handlers to
        // call), not a leak that affects correctness.
      });
    }
  };
}

/** Test-only: closes and clears the module-level Redis clients so a test can
 * reconnect cleanly, matching `apps/{web,gateway}/src/lib/rate-limit.ts`'s own
 * convention. */
export async function _resetMessageBusForTests(): Promise<void> {
  localHandlersByTopic.clear();
  if (publisherClient) {
    await publisherClient.quit().catch(() => {});
    publisherClient = undefined;
  }
  if (subscriberClient) {
    await subscriberClient.quit().catch(() => {});
    subscriberClient = undefined;
  }
}
