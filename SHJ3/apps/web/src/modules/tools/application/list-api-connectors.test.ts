import { describe, expect, it } from "vitest";
import {
  apiConnectorRowFixture,
  FakeApiConnectorRepository,
  FakeToolBindingRepository,
} from "../testing/fakes.js";
import { ListApiConnectors } from "./list-api-connectors.js";

describe("listing the API connector catalogue with live bind counts", () => {
  it("merges each connector with its enabled-binding count", async () => {
    const connectors = new FakeApiConnectorRepository();
    const bindings = new FakeToolBindingRepository();
    connectors.seed(apiConnectorRowFixture({ id: "conn_a", name: "Fetch SEWA bill" }));
    connectors.seed(apiConnectorRowFixture({ id: "conn_b", name: "Create payment link" }));
    await bindings.bind({
      agentVersionId: "agentver_1",
      targetKind: "ApiConnector",
      targetId: "conn_a",
      requiredAssurance: "Verified",
      actorStaffUserId: "usr_admin",
      now: new Date("2026-09-09T00:00:00.000Z"),
    });

    const list = new ListApiConnectors({ connectors, bindings });
    const { rows } = await list.execute();

    expect(rows.find((r) => r.id === "conn_a")?.boundAgentVersionCount).toBe(1);
    expect(rows.find((r) => r.id === "conn_b")?.boundAgentVersionCount).toBe(0);
  });
});
