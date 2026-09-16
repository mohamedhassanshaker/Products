import { describe, expect, it } from "vitest";
import { FakeAgentRepository } from "../testing/fakes.js";
import { CreateAgent } from "./create-agent.js";

describe("creating an agent", () => {
  it("creates a v0.1 Draft agent and returns its ids", async () => {
    const agents = new FakeAgentRepository();
    const create = new CreateAgent({ agents });

    const result = await create.execute({
      name: "Library Services Agent",
      description: "Membership and renewals.",
      ownerTenantId: "tenant-libraries",
      createdByStaffUserId: "usr_01JBADMIN",
      now: new Date("2026-09-09T09:00:00.000Z"),
    });

    expect(result.agentId).toBeTruthy();
    expect(result.agentVersionId).toBeTruthy();

    const detail = await agents.getAgentDetail(result.agentId);
    expect(detail?.name).toBe("Library Services Agent");
    expect(detail?.status).toBe("Draft");

    const version = await agents.getVersion(result.agentVersionId);
    expect(version?.label).toBe("v0.1");
    expect(version?.status).toBe("Draft");
  });

  it("delegates directly to the repository, with no extra logic in between", async () => {
    const agents = new FakeAgentRepository();
    const create = new CreateAgent({ agents });

    const input = {
      name: "Test Agent",
      description: null,
      ownerTenantId: "tenant-1",
      createdByStaffUserId: "usr_01JBADMIN",
      now: new Date("2026-09-09T09:00:00.000Z"),
    };
    await create.execute(input);

    expect(agents.createAgentCalls).toEqual([input]);
  });
});
