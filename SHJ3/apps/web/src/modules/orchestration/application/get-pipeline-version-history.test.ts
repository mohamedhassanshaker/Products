import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { GetPipelineVersionHistory } from "./get-pipeline-version-history.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("GetPipelineVersionHistory", () => {
  it("returns the Created entry for a brand-new design", async () => {
    const pipelines = new FakePipelineRepository();
    const { pipelineDesignId } = await pipelines.createPipeline({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });

    const result = await new GetPipelineVersionHistory({ pipelines }).execute(pipelineDesignId);

    expect(result).toHaveLength(1);
    expect(result[0]?.kind).toBe("Created");
  });
});
