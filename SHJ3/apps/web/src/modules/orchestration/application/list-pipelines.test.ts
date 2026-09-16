import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { ListPipelines } from "./list-pipelines.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("ListPipelines", () => {
  it("returns every seeded design", async () => {
    const pipelines = new FakePipelineRepository();
    await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });
    await pipelines.createPipeline({
      name: "Support escalation",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: new Date(NOW.getTime() + 1000),
    });

    const result = await new ListPipelines({ pipelines }).execute();

    expect(result).toHaveLength(2);
    expect(result.map((r) => r.name).sort()).toEqual(["Billing triage", "Support escalation"]);
  });

  it("returns an empty list for a tenant with no pipelines yet", async () => {
    const pipelines = new FakePipelineRepository();
    const result = await new ListPipelines({ pipelines }).execute();
    expect(result).toEqual([]);
  });
});
