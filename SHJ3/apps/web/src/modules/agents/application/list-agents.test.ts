import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { ListAgents } from "./list-agents.js";

describe("listing the agent registry", () => {
  it("lists every agent when given no filter", async () => {
    const agents = new FakeAgentRepository();
    agents.seedAgent({ name: "SEWA & Utilities Billing Agent", status: "Published" });
    agents.seedAgent({ name: "Library Services Agent", status: "Draft" });
    const list = new ListAgents({ agents });

    const { rows } = await list.execute();
    expect(rows.map((r) => r.name)).toEqual([
      "Library Services Agent",
      "SEWA & Utilities Billing Agent",
    ]);
  });

  it("filters by status", async () => {
    const agents = new FakeAgentRepository();
    agents.seedAgent({ name: "Published One", status: "Published" });
    agents.seedAgent({ name: "Draft One", status: "Draft" });
    const list = new ListAgents({ agents });

    const { rows } = await list.execute({ status: "Published" });
    expect(rows.map((r) => r.name)).toEqual(["Published One"]);
  });

  it("filters by search text", async () => {
    const agents = new FakeAgentRepository();
    agents.seedAgent({ name: "Customs Enquiry Agent" });
    agents.seedAgent({ name: "General FAQ Agent" });
    const list = new ListAgents({ agents });

    const { rows } = await list.execute({ q: "customs" });
    expect(rows.map((r) => r.name)).toEqual(["Customs Enquiry Agent"]);
  });
});
