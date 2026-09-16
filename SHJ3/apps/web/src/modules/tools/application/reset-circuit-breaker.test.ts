import { describe, expect, it } from "vitest";
import {
  circuitBreakerConfigRowFixture,
  FakeCircuitBreakerRepository,
  InMemoryCircuitBreakerStateStore,
} from "../testing/fakes.js";
import { ResetCircuitBreaker } from "./reset-circuit-breaker.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

function harness() {
  const breakers = new FakeCircuitBreakerRepository();
  const state = new InMemoryCircuitBreakerStateStore();
  breakers.seed(
    circuitBreakerConfigRowFixture({
      id: "breaker_a",
      targetKind: "ApiConnector",
      targetId: "conn_a",
    }),
  );
  state.seedState("ApiConnector", "conn_a", {
    state: "Open",
    openedAt: new Date("2026-09-09T08:00:00.000Z"),
    cooldownUntil: new Date("2026-09-09T08:02:00.000Z"),
    consecutiveProbeFailures: 5,
  });
  return { breakers, state, reset: new ResetCircuitBreaker({ breakers, state }) };
}

describe("manually resetting a circuit breaker", () => {
  it("closes the live state and appends a ManualReset ledger event", async () => {
    const { breakers, state, reset } = harness();

    const result = await reset.execute({
      circuitBreakerConfigId: "breaker_a",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect(await state.getState("ApiConnector", "conn_a")).toEqual({
      state: "Closed",
      openedAt: null,
      cooldownUntil: null,
      consecutiveProbeFailures: 0,
    });
    expect(breakers.appendedEvents).toEqual([
      {
        id: "cbevent_fake_1",
        circuitBreakerConfigId: "breaker_a",
        transition: "Closed",
        reason: "ManualReset",
        failureCount: null,
        actorStaffUserId: "usr_admin",
        occurredAt: NOW,
      },
    ]);
  });

  it("returns tools.breaker_not_found for an id that does not exist, writing neither state nor event", async () => {
    const { breakers, state, reset } = harness();

    const result = await reset.execute({
      circuitBreakerConfigId: "breaker_ghost",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "tools.breaker_not_found" });
    expect(breakers.appendedEvents).toHaveLength(0);
    expect(await state.getState("ApiConnector", "conn_a")).not.toBeNull();
  });

  it("throws a legible error rather than reaching the database with an empty actor", async () => {
    const { reset } = harness();

    await expect(
      reset.execute({ circuitBreakerConfigId: "breaker_a", actorStaffUserId: "", now: NOW }),
    ).rejects.toThrow(/non-empty actorStaffUserId/i);
  });

  it("resolves the targetKey discriminator for a breaker with no targetId", async () => {
    const breakers = new FakeCircuitBreakerRepository();
    const state = new InMemoryCircuitBreakerStateStore();
    breakers.seed(
      circuitBreakerConfigRowFixture({
        id: "breaker_whatsapp",
        targetKind: "Channel",
        targetId: null,
        targetKey: "whatsapp_bsp",
      }),
    );
    state.seedState("Channel", "whatsapp_bsp", {
      state: "Open",
      openedAt: NOW,
      cooldownUntil: NOW,
      consecutiveProbeFailures: 10,
    });
    const reset = new ResetCircuitBreaker({ breakers, state });

    await reset.execute({
      circuitBreakerConfigId: "breaker_whatsapp",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect((await state.getState("Channel", "whatsapp_bsp"))?.state).toBe("Closed");
  });
});
