import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createEvalSuite, listCases } from "./eval-service.js";
import { harvestEvalCase } from "./harvesting-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-16, LLD §14.9.3) — one
 * action from a conversation/escalation/denied-Tier-3-approval detail view
 * promotes it into an eval case, stamped with the right provenance
 * (`source`/`sourceRef`) — real Postgres proof for all three source kinds.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("harvestEvalCase — FR-AGT-16", () => {
  it("adds a real eval_case stamped with source=HarvestedConversation and sourceRef pointing back to the conversation", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const suite = await createEvalSuite(ctx, { name: "harvest-suite" });

    const evalCase = await harvestEvalCase(ctx, {
      evalSuiteId: suite.id,
      source: "HarvestedConversation",
      sourceRef: "22222222-2222-2222-2222-222222222222",
      name: "Harvested from conversation",
      inputTranscript: [{ sender: "Customer", text: "I want a refund" }],
      expectedResponsePattern: "refund",
    });

    expect(evalCase.source).toBe("HarvestedConversation");
    expect(evalCase.sourceRef).toBe("22222222-2222-2222-2222-222222222222");

    const cases = await listCases(ctx, suite.id);
    expect(cases).toHaveLength(1);
    expect(cases[0]?.id).toBe(evalCase.id);
  });

  it("supports HarvestedEscalation and HarvestedApprovalDenial provenance the identical way", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const suite = await createEvalSuite(ctx, { name: "harvest-suite-2" });

    const escalationCase = await harvestEvalCase(ctx, {
      evalSuiteId: suite.id,
      source: "HarvestedEscalation",
      sourceRef: "33333333-3333-3333-3333-333333333333",
      name: "Harvested from escalation",
      inputTranscript: [{ sender: "Customer", text: "This is urgent" }],
    });
    expect(escalationCase.source).toBe("HarvestedEscalation");

    const approvalCase = await harvestEvalCase(ctx, {
      evalSuiteId: suite.id,
      source: "HarvestedApprovalDenial",
      sourceRef: "44444444-4444-4444-4444-444444444444",
      name: "Harvested from denied Tier-3 approval",
      inputTranscript: [{ sender: "AI", text: "Requesting a $500 refund" }],
    });
    expect(approvalCase.source).toBe("HarvestedApprovalDenial");
  });
});
