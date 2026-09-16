import { describe, expect, it } from "vitest";
import { GetOrCreateDraftFlowVersion } from "./get-or-create-draft-flow-version.js";
import { FakeFlowRepository, flowVersionRowFixture } from "../testing/fakes.js";

const now = new Date("2026-09-11T00:00:00.000Z");

describe("GetOrCreateDraftFlowVersion", () => {
  it("creates a brand-new flow when existingFlowId is null", async () => {
    const flows = new FakeFlowRepository();
    const result = await new GetOrCreateDraftFlowVersion({ flows }).execute({
      existingFlowId: null,
      newFlowName: "New flow",
      ownerTenantId: "tenant-1",
      actorStaffUserId: "staff-1",
      now,
    });
    const version = await flows.getFlowVersion(result.flowVersionId);
    expect(version?.status).toBe("Draft");
  });

  it("forks a fresh Draft when the existing flow's current version is Published and no bound version id is supplied", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(flowVersionRowFixture({ id: "flowver-1", flowId: "flow-1", status: "Published" }));

    const result = await new GetOrCreateDraftFlowVersion({ flows }).execute({
      existingFlowId: "flow-1",
      newFlowName: "unused",
      ownerTenantId: "tenant-1",
      actorStaffUserId: "staff-1",
      now,
    });

    expect(result.flowVersionId).not.toBe("flowver-1");
    const version = await flows.getFlowVersion(result.flowVersionId);
    expect(version?.status).toBe("Draft");
  });

  /**
   * The real, live-reproduced bug (found by a Playwright verification pass on the
   * `@xyflow/react` Flow Designer canvas, not a review): every page load re-forked a brand-new
   * empty Draft, because nothing ever checked whether the version the caller was ALREADY bound
   * to editing was itself still a Draft before calling `forkOrReuseDraftVersion` again —
   * `Flow.currentVersionId` never resolves to a forked-but-unpublished Draft, so that method's
   * own internal reuse check never fired on a second call. This is the regression test for the
   * fix: a second `execute()` call, now supplying `existingFlowVersionId`, must return the
   * SAME version id as the first, not fork another one.
   */
  it("reuses the already-bound Draft version instead of forking a new one on a second call", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(flowVersionRowFixture({ id: "flowver-1", flowId: "flow-1", status: "Published" }));

    const useCase = new GetOrCreateDraftFlowVersion({ flows });
    const first = await useCase.execute({
      existingFlowId: "flow-1",
      newFlowName: "unused",
      ownerTenantId: "tenant-1",
      actorStaffUserId: "staff-1",
      now,
    });
    expect(first.flowVersionId).not.toBe("flowver-1");

    // Simulates a second page load — the caller now supplies the version id it bound to on the
    // first load (`AgentFlowBinding.flowVersionId`, in the real screen).
    const second = await useCase.execute({
      existingFlowId: "flow-1",
      existingFlowVersionId: first.flowVersionId,
      newFlowName: "unused",
      ownerTenantId: "tenant-1",
      actorStaffUserId: "staff-1",
      now,
    });

    expect(second.flowVersionId).toBe(first.flowVersionId);
  });

  it("falls through to forkOrReuseDraftVersion when the bound version id no longer exists", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(flowVersionRowFixture({ id: "flowver-1", flowId: "flow-1", status: "Published" }));

    const result = await new GetOrCreateDraftFlowVersion({ flows }).execute({
      existingFlowId: "flow-1",
      existingFlowVersionId: "flowver-deleted",
      newFlowName: "unused",
      ownerTenantId: "tenant-1",
      actorStaffUserId: "staff-1",
      now,
    });

    expect(result.flowVersionId).not.toBe("flowver-deleted");
    const version = await flows.getFlowVersion(result.flowVersionId);
    expect(version?.status).toBe("Draft");
  });

  it("forks again when the bound version id has since become Published (e.g. published by another editor)", async () => {
    const flows = new FakeFlowRepository();
    flows.seedVersion(flowVersionRowFixture({ id: "flowver-1", flowId: "flow-1", status: "Published" }));

    const result = await new GetOrCreateDraftFlowVersion({ flows }).execute({
      existingFlowId: "flow-1",
      existingFlowVersionId: "flowver-1",
      newFlowName: "unused",
      ownerTenantId: "tenant-1",
      actorStaffUserId: "staff-1",
      now,
    });

    expect(result.flowVersionId).not.toBe("flowver-1");
    const version = await flows.getFlowVersion(result.flowVersionId);
    expect(version?.status).toBe("Draft");
  });
});
