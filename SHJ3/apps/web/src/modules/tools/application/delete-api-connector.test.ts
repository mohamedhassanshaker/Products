import { describe, expect, it } from "vitest";
import { apiConnectorRowFixture, FakeApiConnectorRepository } from "../testing/fakes.js";
import { DeleteApiConnector } from "./delete-api-connector.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("deleting an API connector", () => {
  it("soft-deletes a connector with no active bindings", async () => {
    const connectors = new FakeApiConnectorRepository();
    connectors.seed(apiConnectorRowFixture({ id: "conn_a" }));
    const del = new DeleteApiConnector({ connectors });

    expect(await del.execute({ id: "conn_a", now: NOW })).toEqual({ ok: true });
    expect(await connectors.get("conn_a")).toBeNull();
  });

  it("refuses, naming the bound agent versions, when the connector or its projected skill is still in use", async () => {
    const connectors = new FakeApiConnectorRepository();
    connectors.seed(apiConnectorRowFixture({ id: "conn_a" }));
    connectors.blockDelete("conn_a", ["agentver_1"]);
    const del = new DeleteApiConnector({ connectors });

    const result = await del.execute({ id: "conn_a", now: NOW });
    expect(result).toEqual({
      ok: false,
      reason: "tools.connector_in_use",
      boundAgentVersionIds: ["agentver_1"],
    });
  });
});
