import { describe, expect, it } from "vitest";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { Principal } from "../../platform/tenancy/tenant-context.js";
import { FakeAuditSink, FakePublishGateRepository } from "../testing/fakes.js";
import { gateDisabledConsequenceText, UpdatePublishGate } from "./update-publish-gate.js";

const now = new Date("2026-09-10T10:00:00.000Z");

function fakeTenantSlug(value: string): TenantSlug {
  return value as unknown as TenantSlug;
}

function fakePrincipal(): Principal {
  return {
    id: "staff_1",
    tenant: fakeTenantSlug("sewa"),
    displayName: "Sara Al Mazrouei",
    roles: ["EntityAdmin"],
    permissions: new Set(["evaluation:manage"]),
    assurance: "L0",
  };
}

describe("UpdatePublishGate", () => {
  it("persists the new settings and audits the change", async () => {
    const gate = new FakePublishGateRepository();
    const audit = new FakeAuditSink();
    const useCase = new UpdatePublishGate({ gate, audit });

    const result = await useCase.execute({
      principal: fakePrincipal(),
      blockOnSuiteFailure: true,
      minAccuracy: 0.9,
      minGroundedness: 0.85,
      redTeamMustScore100: true,
      blockOnBoundLocaleBelow100: true,
      now,
    });

    expect(result.minAccuracy).toBe(0.9);
    expect(audit.recorded).toHaveLength(1);
    expect(audit.recorded[0]?.action).toBe("evaluation.publish_gate_updated");
    expect(audit.recorded[0]?.after).toMatchObject({ minAccuracy: 0.9 });
  });

  it("FR-EVAL-13: audits a gate-disabled save distinguishably from an ordinary save", async () => {
    const gate = new FakePublishGateRepository();
    const audit = new FakeAuditSink();
    const useCase = new UpdatePublishGate({ gate, audit });

    await useCase.execute({
      principal: fakePrincipal(),
      blockOnSuiteFailure: false,
      minAccuracy: 0.85,
      minGroundedness: 0.8,
      redTeamMustScore100: true,
      blockOnBoundLocaleBelow100: true,
      now,
    });

    expect(audit.recorded[0]?.summary).toContain(gateDisabledConsequenceText());
  });
});
