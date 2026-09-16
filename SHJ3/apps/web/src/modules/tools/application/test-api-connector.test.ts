import { describe, expect, it } from "vitest";
import { apiConnectorRowFixture, FakeApiConnectorRepository } from "../testing/fakes.js";
import { TestApiConnector } from "./test-api-connector.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("testing an API connector's connection", () => {
  it("returns tools.test_execution_not_implemented alongside the current connector row, never a fake success", async () => {
    const connectors = new FakeApiConnectorRepository();
    const seeded = apiConnectorRowFixture({ id: "conn_a", testState: "Untested" });
    connectors.seed(seeded);
    const testConnector = new TestApiConnector({ connectors });

    const result = await testConnector.execute({ id: "conn_a", now: NOW });

    expect(result).toEqual({
      ok: false,
      reason: "tools.test_execution_not_implemented",
      connector: seeded,
    });
  });

  it("never calls recordTestResult — there is nothing real to record", async () => {
    const connectors = new FakeApiConnectorRepository();
    connectors.seed(apiConnectorRowFixture({ id: "conn_a", testState: "Untested" }));
    const testConnector = new TestApiConnector({ connectors });

    await testConnector.execute({ id: "conn_a", now: NOW });

    // testState/lastTestedAt/sampleResponseJson must be exactly as seeded — untouched.
    const connector = await connectors.get("conn_a");
    expect(connector?.testState).toBe("Untested");
    expect(connector?.lastTestedAt).toBeNull();
    expect(connector?.sampleResponseJson).toBeNull();
  });

  it("throws a legible error for a connector that does not exist", async () => {
    const connectors = new FakeApiConnectorRepository();
    const testConnector = new TestApiConnector({ connectors });

    await expect(testConnector.execute({ id: "conn_ghost", now: NOW })).rejects.toThrow(
      /no such connector/i,
    );
  });
});
