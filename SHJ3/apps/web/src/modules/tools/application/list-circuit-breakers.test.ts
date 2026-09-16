import { describe, expect, it } from "vitest";
import { DEFAULT_BREAKER_STATE } from "../ports/circuit-breaker-state-store.js";
import {
  circuitBreakerConfigRowFixture,
  FakeCircuitBreakerRepository,
  InMemoryCircuitBreakerStateStore,
} from "../testing/fakes.js";
import { ListCircuitBreakers } from "./list-circuit-breakers.js";

describe("listing circuit breakers with live Redis state", () => {
  it("uses DEFAULT_BREAKER_STATE (closed) when Redis has no key for a breaker yet", async () => {
    const breakers = new FakeCircuitBreakerRepository();
    const state = new InMemoryCircuitBreakerStateStore();
    breakers.seed(
      circuitBreakerConfigRowFixture({
        id: "breaker_a",
        targetKind: "McpServer",
        targetId: "mcp_a",
      }),
    );

    const list = new ListCircuitBreakers({ breakers, state });
    const { rows } = await list.execute();

    expect(rows[0]?.liveState).toEqual(DEFAULT_BREAKER_STATE);
  });

  it("surfaces the real live state when Redis has one, resolved via the target's own discriminator", async () => {
    const breakers = new FakeCircuitBreakerRepository();
    const state = new InMemoryCircuitBreakerStateStore();
    breakers.seed(
      circuitBreakerConfigRowFixture({
        id: "breaker_a",
        targetKind: "ApiConnector",
        targetId: "conn_a",
      }),
    );
    const openedAt = new Date("2026-09-09T08:00:00.000Z");
    const cooldownUntil = new Date("2026-09-09T08:02:00.000Z");
    state.seedState("ApiConnector", "conn_a", {
      state: "Open",
      openedAt,
      cooldownUntil,
      consecutiveProbeFailures: 5,
    });

    const list = new ListCircuitBreakers({ breakers, state });
    const { rows } = await list.execute();

    expect(rows[0]?.liveState).toEqual({
      state: "Open",
      openedAt,
      cooldownUntil,
      consecutiveProbeFailures: 5,
    });
  });

  it("resolves the targetKey discriminator for a breaker with no targetId (e.g. WhatsApp BSP)", async () => {
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
      state: "Closed",
      openedAt: null,
      cooldownUntil: null,
      consecutiveProbeFailures: 0,
    });

    const list = new ListCircuitBreakers({ breakers, state });
    const { rows } = await list.execute();

    expect(rows[0]?.liveState.state).toBe("Closed");
  });
});
