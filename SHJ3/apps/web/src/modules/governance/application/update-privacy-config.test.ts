import { describe, expect, it } from "vitest";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import { FakeAuditSink, FakePrivacyConfigRepository } from "../testing/fakes.js";
import { InvalidPrivacyConfigValueError, UpdatePrivacyConfig } from "./update-privacy-config.js";

const now = new Date("2026-09-10T10:00:00.000Z");
const actor = {
  id: "staff_1",
  tenant: "sewa",
  displayName: "Ahmed Saeed",
  roles: ["EntityAdmin"],
  permissions: new Set(["governance:manage"]),
  assurance: "L0",
} as unknown as Principal;

describe("UpdatePrivacyConfig", () => {
  it("persists the new settings and writes a real audit entry", async () => {
    const privacyConfig = new FakePrivacyConfigRepository();
    const audit = new FakeAuditSink();

    const result = await new UpdatePrivacyConfig({ privacyConfig, audit }).execute({
      consentLedgerEnabled: true,
      honourErasureRequests: true,
      transcriptRetention: "Year1",
      dataResidency: "UaeDubaiDc",
      actor,
      now,
    });

    expect(result.transcriptRetention).toBe("Year1");
    expect(audit.recorded).toHaveLength(1);
    expect(audit.recorded[0]?.action).toBe("governance.privacy_config_updated");
  });

  it("rejects a retention value outside the real closed vocabulary", async () => {
    const privacyConfig = new FakePrivacyConfigRepository();
    const audit = new FakeAuditSink();

    await expect(
      new UpdatePrivacyConfig({ privacyConfig, audit }).execute({
        consentLedgerEnabled: true,
        honourErasureRequests: true,
        transcriptRetention: "Year10",
        dataResidency: "UaeSharjahDc",
        actor,
        now,
      }),
    ).rejects.toThrow(InvalidPrivacyConfigValueError);
    expect(audit.recorded).toHaveLength(0);
  });
});
