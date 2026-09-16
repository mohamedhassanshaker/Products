import { describe, expect, it } from "vitest";
import { FakeApiConnectorRepository } from "../testing/fakes.js";
import { CreateApiConnector } from "./create-api-connector.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("registering an API connector", () => {
  it("creates the connector already Untested, with its projected skill id surfaced", async () => {
    const connectors = new FakeApiConnectorRepository();
    const create = new CreateApiConnector({ connectors });

    const { connector } = await create.execute({
      name: "Create payment link",
      method: "POST",
      urlTemplate: "https://pay.shj.ae/v1/links",
      authMode: "OAuth2ClientCredentials",
      credentialSecretRef: "env:PAY_SHJ_CLIENT_SECRET",
      headersJson: null,
      requestSchemaJson: null,
      responseSchemaJson: null,
      timeoutMs: 15_000,
      rateLimitPolicy: {
        name: "pay-shj-links-default",
        requestsPerWindow: 100,
        windowSeconds: 60,
        burst: 10,
        scope: "PerTenant",
      },
      now: NOW,
    });

    expect(connector.testState).toBe("Untested");
    expect(connector.projectedSkillId).toBeTruthy();
    expect(connector.rateLimitPolicyId).toBeTruthy();
    expect(await connectors.list()).toEqual([connector]);
  });
});
