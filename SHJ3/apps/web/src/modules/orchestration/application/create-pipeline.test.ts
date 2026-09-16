import { describe, expect, it } from "vitest";
import { FakePipelineRepository } from "../testing/fakes.js";
import { CreatePipeline } from "./create-pipeline.js";

const NOW = new Date("2026-09-16T10:00:00.000Z");

describe("CreatePipeline", () => {
  it("creates a design with a Draft v0.1 version and a lone Start node", async () => {
    const pipelines = new FakePipelineRepository();
    const result = await new CreatePipeline({ pipelines }).execute({
      name: "Billing triage",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const design = await pipelines.getDesign(result.pipelineDesignId);
    expect(design?.status).toBe("Draft");
    const canvas = await pipelines.getCanvas(result.pipelineVersionId);
    expect(canvas?.version.major).toBe(0);
    expect(canvas?.version.minor).toBe(1);
    expect(canvas?.nodes).toHaveLength(1);
    expect(canvas?.nodes[0]?.kind).toBe("Start");
  });

  it("rejects a blank name without touching the repository", async () => {
    const pipelines = new FakePipelineRepository();
    const result = await new CreatePipeline({ pipelines }).execute({
      name: "   ",
      ownerTenantId: "tenant_1",
      createdByStaffUserId: "staff_1",
      now: NOW,
    });

    expect(result).toEqual({ ok: false, reason: "orchestration.pipeline.name_required" });
    expect(await pipelines.listDesigns()).toEqual([]);
  });
});
