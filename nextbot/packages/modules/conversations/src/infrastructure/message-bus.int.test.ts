import { afterAll, describe, expect, it, vi } from "vitest";

/**
 * QA fix D3 — real Redis, real cross-client delivery. This is the closest a single
 * test process can get to proving the actual bug/fix: two entirely independent
 * `ioredis` client instances (module-reset between "sides") standing in for
 * `apps/web`'s and `apps/gateway`'s two separate OS processes. Before this fix,
 * `subscribeToConversation`/`publishConversationEvent` shared nothing but an
 * in-process `EventEmitter`, so a "publish from side A, subscribe from side B" never
 * delivered — this test would have failed against the pre-fix implementation and
 * passes now that both sides talk to the same real Redis instance.
 */
describe("message-bus (Redis pub/sub, QA fix D3, real Redis)", () => {
  afterAll(async () => {
    vi.resetModules();
  });

  it("an event published from one client instance is delivered to a subscriber on a completely separate client instance", async () => {
    vi.resetModules();
    const sideA = await import("./message-bus.js");

    vi.resetModules();
    const sideB = await import("./message-bus.js");

    const received: unknown[] = [];
    const unsubscribe = sideB.subscribeToConversation("conv-cross-process", (event) => received.push(event));

    // Give the subscribe SUBSCRIBE command a moment to actually register with Redis
    // before publishing — real network round-trips, unlike the mocked unit test.
    await new Promise((resolve) => setTimeout(resolve, 200));

    sideA.publishConversationEvent("conv-cross-process", { event: "typing", data: { actor: "human", state: "start" } });

    await vi.waitFor(() => {
      expect(received).toContainEqual({ event: "typing", data: { actor: "human", state: "start" } });
    }, { timeout: 5000 });

    unsubscribe();
    await sideA._resetMessageBusForTests();
    await sideB._resetMessageBusForTests();
  });
});
