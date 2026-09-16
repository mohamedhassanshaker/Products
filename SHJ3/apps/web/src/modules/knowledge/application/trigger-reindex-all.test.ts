import { describe, expect, it } from "vitest";
import { TriggerReindexAll } from "./trigger-reindex-all.js";
import { FakeReindexJobRepository, reindexJobRowFixture } from "../testing/fakes.js";

const NOW = new Date("2026-09-09T09:00:00.000Z");

describe("triggering a full tenant re-index (FR-KNOW-16)", () => {
  it("queues a Tenant-scope Manual job", async () => {
    const reindexJobs = new FakeReindexJobRepository();
    const result = await new TriggerReindexAll({ reindexJobs }).execute({
      ranByStaffUserId: "usr_admin",
      now: NOW,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.job.scope).toBe("Tenant");
    expect(result.job.reason).toBe("Manual");
    expect(result.job.state).toBe("Queued");
  });

  it("refuses a second concurrent tenant-wide job, mirroring UQ_ReindexJobs_activeTenantScope", async () => {
    const reindexJobs = new FakeReindexJobRepository();
    reindexJobs.seed(reindexJobRowFixture({ id: "active", scope: "Tenant", state: "Running" }));
    const result = await new TriggerReindexAll({ reindexJobs }).execute({
      ranByStaffUserId: "usr_admin",
      now: NOW,
    });
    expect(result).toEqual({ ok: false, reason: "knowledge.reindex_already_running" });
  });
});
