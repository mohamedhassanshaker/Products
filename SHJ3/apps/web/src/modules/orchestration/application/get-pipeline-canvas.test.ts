import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { GetPipelineCanvas } from "./get-pipeline-canvas.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("GetPipelineCanvas", () => {
  it("returns the version, its nodes, and its edges together", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineVersionId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });

    const result = await new GetPipelineCanvas({ pipelines }).execute(pipelineVersionId);

    expect(result?.version.id).toBe(pipelineVersionId);
    expect(result?.nodes).toHaveLength(1);
    expect(result?.nodes[0]?.kind).toBe("Start");
    expect(result?.edges).toEqual([]);
  });

  it("returns null for a version that does not exist", async () => {
    const pipelines = new FakePipelineRepository();
    const result = await new GetPipelineCanvas({ pipelines }).execute("pv_does_not_exist");
    expect(result).toBeNull();
  });
});
