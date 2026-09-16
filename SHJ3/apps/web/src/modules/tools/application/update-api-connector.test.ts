import { describe, expect, it } from "vitest";
import { apiConnectorRowFixture, FakeApiConnectorRepository } from "../testing/fakes.js";
import { UpdateApiConnector } from "./update-api-connector.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("updating an API connector", () => {
  it("edits only the fields supplied", async () => {
    const connectors = new FakeApiConnectorRepository();
    connectors.seed(apiConnectorRowFixture({ id: "conn_a", name: "Old name", timeoutMs: 5_000 }));
    const update = new UpdateApiConnector({ connectors });

    await update.execute({ id: "conn_a", name: "New name", now: NOW });

    const connector = await connectors.get("conn_a");
    expect(connector?.name).toBe("New name");
    expect(connector?.timeoutMs).toBe(5_000);
  });

  it("resets testState to Untested when the request shape changes", async () => {
    const connectors = new FakeApiConnectorRepository();
    connectors.seed(
      apiConnectorRowFixture({ id: "conn_a", testState: "Tested", lastTestedAt: NOW }),
    );
    const update = new UpdateApiConnector({ connectors });

    await update.execute({
      id: "conn_a",
      urlTemplate: "https://api.sewa.ae/v2/bills/{account}",
      now: NOW,
    });

    const connector = await connectors.get("conn_a");
    expect(connector?.testState).toBe("Untested");
    expect(connector?.lastTestedAt).toBeNull();
  });

  it("leaves testState alone when only non-request fields change", async () => {
    const connectors = new FakeApiConnectorRepository();
    connectors.seed(
      apiConnectorRowFixture({ id: "conn_a", testState: "Tested", lastTestedAt: NOW }),
    );
    const update = new UpdateApiConnector({ connectors });

    await update.execute({ id: "conn_a", timeoutMs: 20_000, now: NOW });

    expect((await connectors.get("conn_a"))?.testState).toBe("Tested");
  });
});
