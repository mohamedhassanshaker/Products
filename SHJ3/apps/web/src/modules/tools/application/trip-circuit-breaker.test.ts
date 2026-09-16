import { describe, expect, it } from "vitest";
import {
  circuitBreakerConfigRowFixture,
  FakeCircuitBreakerRepository,
  InMemoryCircuitBreakerStateStore,
} from "../testing/fakes.js";
import { TripCircuitBreaker } from "./trip-circuit-breaker.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

function harness() {
  const breakers = new FakeCircuitBreakerRepository();
  const state = new InMemoryCircuitBreakerStateStore();
  breakers.seed(
    circuitBreakerConfigRowFixture({
      id: "breaker_a",
      targetKind: "ApiConnector",
      targetId: "conn_a",
      cooldownSeconds: 120,
    }),
  );
  return { breakers, state, trip: new TripCircuitBreaker({ breakers, state }) };
}

describe("manually tripping a circuit breaker", () => {
  it("opens the live state with openedAt/cooldownUntil derived from the config, and appends a ManualTrip event", async () => {
    const { breakers, state, trip } = harness();

    const result = await trip.execute({
      circuitBreakerConfigId: "breaker_a",
      reason: "Demonstrating the fallback path for a stakeholder demo.",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result).toEqual({ ok: true });
    expect(await state.getState("ApiConnector", "conn_a")).toEqual({
      state: "Open",
      openedAt: NOW,
      cooldownUntil: new Date(NOW.getTime() + 120_000),
      consecutiveProbeFailures: 0,
    });
    expect(breakers.appendedEvents).toEqual([
      {
        id: "cbevent_fake_1",
        circuitBreakerConfigId: "breaker_a",
        transition: "Open",
        reason: "ManualTrip",
        failureCount: null,
        actorStaffUserId: "usr_admin",
        occurredAt: NOW,
      },
    ]);
  });

  it("does not persist the free-text reason anywhere — it is honestly dropped after validation", async () => {
    const { breakers, trip } = harness();

    await trip.execute({
      circuitBreakerConfigId: "breaker_a",
      reason: "A reason nobody will ever read back.",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    const event = breakers.appendedEvents[0];
    expect(event).not.toHaveProperty("justification");
    expect(event).not.toHaveProperty("note");
    expect(Object.keys(event ?? {}).sort()).toEqual(
      [
        "actorStaffUserId",
        "circuitBreakerConfigId",
        "failureCount",
        "id",
        "occurredAt",
        "reason",
        "transition",
      ].sort(),
    );
  });

  it("rejects an empty reason before reaching the repository", async () => {
    const { breakers, trip } = harness();

    await expect(
      trip.execute({
        circuitBreakerConfigId: "breaker_a",
        reason: "   ",
        actorStaffUserId: "usr_admin",
        now: NOW,
      }),
    ).rejects.toThrow(/non-empty reason/i);
    expect(breakers.appendedEvents).toHaveLength(0);
  });

  it("rejects an empty actor before reaching the repository", async () => {
    const { breakers, trip } = harness();

    await expect(
      trip.execute({
        circuitBreakerConfigId: "breaker_a",
        reason: "Testing fallback",
        actorStaffUserId: "",
        now: NOW,
      }),
    ).rejects.toThrow(/non-empty actorStaffUserId/i);
    expect(breakers.appendedEvents).toHaveLength(0);
  });

  it("returns tools.breaker_not_found for an id that does not exist", async () => {
    const { trip } = harness();

    const result = await trip.execute({
      circuitBreakerConfigId: "breaker_ghost",
      reason: "Testing fallback",
      actorStaffUserId: "usr_admin",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "tools.breaker_not_found" });
  });
});
