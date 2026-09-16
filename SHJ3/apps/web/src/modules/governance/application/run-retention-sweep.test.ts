import { describe, expect, it } from "vitest";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import {
  FakeAuditSink,
  FakeCitizenCacheEraser,
  FakePrivacyConfigRepository,
  FakeRetentionSweepDataRepository,
  FakeRetentionSweepRunRepository,
} from "../testing/fakes.js";
import { RunRetentionSweep } from "./run-retention-sweep.js";

const now = new Date("2026-09-10T10:00:00.000Z");
const past = new Date("2026-01-01T00:00:00.000Z");
const future = new Date("2027-01-01T00:00:00.000Z");
const actor = {
  id: "staff_1",
  tenant: "sewa",
  displayName: "Ahmed Saeed",
  roles: ["SuperAdmin"],
  permissions: new Set(["governance:manage"]),
  assurance: "L0",
} as unknown as Principal;

describe("RunRetentionSweep", () => {
  it("purges only conversations already past their own stamped retentionExpiresAt, and skips transactions honestly", async () => {
    const privacyConfig = new FakePrivacyConfigRepository();
    privacyConfig.seed({
      id: "privacy_1",
      consentLedgerEnabled: true,
      honourErasureRequests: true,
      transcriptRetention: "Days90",
      dataResidency: "UaeSharjahDc",
      updatedByStaffUserId: "staff_1",
      updatedAt: now,
    });

    const data = new FakeRetentionSweepDataRepository();
    data.seed({
      id: "conv_expired",
      redisSessionKey: "conv:conv_expired",
      retentionExpiresAt: past,
      erasedAt: null,
    });
    data.seed({
      id: "conv_active",
      redisSessionKey: "conv:conv_active",
      retentionExpiresAt: future,
      erasedAt: null,
    });
    data.turnCounts.set("conv_expired", 12);
    data.traceCounts.set("conv_expired", 3);
    data.transactionLinkCounts.set("conv_expired", 1);

    const cache = new FakeCitizenCacheEraser();
    cache.result = { affectedCount: 2, verificationQuery: "fake" };

    const runs = new FakeRetentionSweepRunRepository();
    const audit = new FakeAuditSink();

    const result = await new RunRetentionSweep({ privacyConfig, data, cache, runs, audit }).execute(
      {
        actor,
        now,
      },
    );

    expect(result.conversationsPurged).toBe(1);
    expect(result.turnsPurged).toBe(12);
    expect(result.tracesPurged).toBe(3);
    expect(result.transactionsSkipped).toBe(1);
    expect(result.redisKeysPurged).toBe(2);
    expect(result.state).toBe("Completed");
    expect(data.conversations.get("conv_active")?.erasedAt).toBeNull();
    expect(data.conversations.get("conv_expired")?.erasedAt).toEqual(now);
    expect(audit.recorded).toHaveLength(1);
  });
});
