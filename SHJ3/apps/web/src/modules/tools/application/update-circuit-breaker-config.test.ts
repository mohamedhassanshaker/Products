import { describe, expect, it } from "vitest";
import { circuitBreakerConfigRowFixture, FakeCircuitBreakerRepository } from "../testing/fakes.js";
import { UpdateCircuitBreakerConfig } from "./update-circuit-breaker-config.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("updating a circuit breaker's configuration", () => {
  it("edits only the fields supplied, writing no live state and no ledger event", async () => {
    const breakers = new FakeCircuitBreakerRepository();
    breakers.seed(
      circuitBreakerConfigRowFixture({
        id: "breaker_a",
        failureThreshold: 5,
        cooldownSeconds: 120,
      }),
    );
    const update = new UpdateCircuitBreakerConfig({ breakers });

    await update.execute({ id: "breaker_a", failureThreshold: 10, now: NOW });

    const config = await breakers.get("breaker_a");
    expect(config?.failureThreshold).toBe(10);
    expect(config?.cooldownSeconds).toBe(120);
    expect(breakers.appendedEvents).toHaveLength(0);
  });

  it("can disable a breaker entirely via isEnabled", async () => {
    const breakers = new FakeCircuitBreakerRepository();
    breakers.seed(circuitBreakerConfigRowFixture({ id: "breaker_a", isEnabled: true }));
    const update = new UpdateCircuitBreakerConfig({ breakers });

    await update.execute({ id: "breaker_a", isEnabled: false, now: NOW });

    expect((await breakers.get("breaker_a"))?.isEnabled).toBe(false);
  });
});
