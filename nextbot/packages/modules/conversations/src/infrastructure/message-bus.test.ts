import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * QA fix D3: `message-bus.ts` now backs its fan-out with real Redis pub/sub (a
 * cross-process delivery mechanism) instead of an in-process `EventEmitter` — this
 * unit test mocks `ioredis` itself (same convention as `apps/gateway`/`apps/web`'s
 * own `rate-limit.test.ts`) so it stays a fast, no-real-Redis unit test that
 * verifies the module's own subscribe/publish/fan-out wiring. The genuinely
 * cross-process claim ("two separate `ioredis` client instances, standing in for
 * two separate OS processes, both talking to the same Redis") is covered by
 * `message-bus.int.test.ts` against a real Redis instance.
 */

interface FakeRedisInstance {
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribe: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  quit: ReturnType<typeof vi.fn>;
  emitMessage: (channel: string, message: string) => void;
}

const instances: FakeRedisInstance[] = [];

vi.mock("ioredis", () => {
  return {
    default: class FakeRedis {
      publish = vi.fn().mockResolvedValue(1);
      subscribe = vi.fn().mockResolvedValue(undefined);
      unsubscribe = vi.fn().mockResolvedValue(undefined);
      quit = vi.fn().mockResolvedValue(undefined);
      private messageHandlers: Array<(channel: string, message: string) => void> = [];
      on = vi.fn((event: string, handler: (...args: unknown[]) => void) => {
        if (event === "message") this.messageHandlers.push(handler as (channel: string, message: string) => void);
      });
      constructor() {
        instances.push({
          publish: this.publish,
          subscribe: this.subscribe,
          unsubscribe: this.unsubscribe,
          on: this.on,
          quit: this.quit,
          emitMessage: (channel: string, message: string) => {
            for (const h of this.messageHandlers) h(channel, message);
          },
        });
      }
    },
  };
});

describe("message-bus (Redis pub/sub fan-out, QA fix D3)", () => {
  beforeEach(() => {
    instances.length = 0;
  });
  afterEach(async () => {
    const { _resetMessageBusForTests } = await import("./message-bus.js");
    await _resetMessageBusForTests();
    vi.resetModules();
  });

  it("subscribes to the topic on Redis and delivers a fanned-in message to the local callback", async () => {
    const { publishConversationEvent, subscribeToConversation } = await import("./message-bus.js");
    const onEvent = vi.fn();
    const unsubscribe = subscribeToConversation("conv-1", onEvent);

    // Two clients are created lazily: one publisher, one subscriber.
    const subscriberInstance = instances.find((i) => i.subscribe.mock.calls.length > 0)!;
    expect(subscriberInstance.subscribe).toHaveBeenCalledWith("conversation:conv-1");

    // Simulate Redis delivering a message published from *any* process (including
    // this one) back down the subscriber connection.
    subscriberInstance.emitMessage("conversation:conv-1", JSON.stringify({ event: "typing", data: { actor: "ai", state: "start" } }));
    expect(onEvent).toHaveBeenCalledWith({ event: "typing", data: { actor: "ai", state: "start" } });

    unsubscribe();
    publishConversationEvent("conv-1", { event: "typing", data: { actor: "ai", state: "stop" } });
  });

  it("does not deliver a message published on a different topic", async () => {
    const { subscribeToConversation } = await import("./message-bus.js");
    const onEvent = vi.fn();
    subscribeToConversation("conv-a", onEvent);
    const subscriberInstance = instances.find((i) => i.subscribe.mock.calls.length > 0)!;
    subscriberInstance.emitMessage("conversation:conv-b", JSON.stringify({ event: "typing", data: { actor: "ai", state: "start" } }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("unsubscribe stops further local delivery and unsubscribes from Redis once no local handlers remain", async () => {
    const { subscribeToConversation } = await import("./message-bus.js");
    const onEvent = vi.fn();
    const unsubscribe = subscribeToConversation("conv-2", onEvent);
    const subscriberInstance = instances.find((i) => i.subscribe.mock.calls.length > 0)!;

    unsubscribe();
    expect(subscriberInstance.unsubscribe).toHaveBeenCalledWith("conversation:conv-2");

    subscriberInstance.emitMessage("conversation:conv-2", JSON.stringify({ event: "typing", data: { actor: "ai", state: "stop" } }));
    expect(onEvent).not.toHaveBeenCalled();
  });

  it("publishConversationEvent publishes the JSON-serialized event to the topic's Redis channel", async () => {
    const { publishConversationEvent } = await import("./message-bus.js");
    publishConversationEvent("conv-3", { event: "typing", data: { actor: "human", state: "start" } });
    // Publishing lazily creates the publisher client.
    await Promise.resolve();
    const publisherInstance = instances.find((i) => i.publish.mock.calls.length > 0)!;
    expect(publisherInstance.publish).toHaveBeenCalledWith(
      "conversation:conv-3",
      JSON.stringify({ event: "typing", data: { actor: "human", state: "start" } }),
    );
  });

  it("publishing with no subscribers is a safe no-op (never throws)", async () => {
    const { publishConversationEvent } = await import("./message-bus.js");
    expect(() => publishConversationEvent("conv-none", { event: "typing", data: { actor: "human", state: "start" } })).not.toThrow();
  });
});
