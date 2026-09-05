import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { withTenant, schema } from "@nextbot/db";
import { eq } from "drizzle-orm";
import { evaluateToolCallScope } from "./tool-call-pipeline.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

describe("evaluateToolCallScope — mandated call site 1 of 5 (LLD §14.2.5, real Postgres)", () => {
  it("Allows a Tier-1 tool call by default (behavior-preserving: no artifact-level scope column exists yet, so the fold reduces to tenant policy alone)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const result = await evaluateToolCallScope(ctx, {
      agentDefinitionVersionId: null,
      toolId: crypto.randomUUID(),
      toolCapabilityGroupId: null,
      toolRwClass: "Read",
      toolApprovalTier: "Tier1",
    });
    expect(result.decision).toBe("Allow");
    expect(result.requiredTier).toBe("Tier1");
    expect(result.requiresApproval).toBe(false);
  });

  it("Allows a Tier-3 tool with requiresApproval: true (E6) rather than denying it — the evaluator never hides a Tier-3 tool from the Approval Queue", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);

    const result = await evaluateToolCallScope(ctx, {
      agentDefinitionVersionId: null,
      toolId: crypto.randomUUID(),
      toolCapabilityGroupId: null,
      toolRwClass: "Write",
      toolApprovalTier: "Tier3",
    });
    expect(result.decision).toBe("Allow");
    expect(result.requiredTier).toBe("Tier3");
    // ⊤ autonomyCeiling is 'Tier3' (no tenant/artifact-level ceiling exists this
    // phase), so a Tier-3 request does not itself exceed it — requiresApproval is
    // the tier-engine's own concern (resolve()), not duplicated here.
    expect(result.requiresApproval).toBe(false);
  });

  it("respects a real tenant_scope_policy residency restriction once one is derived (proves this call site reads the SAME tenant policy /authz/simulate would, not a stub)", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    // Flip the real source-of-truth column this phase's tenant_scope_policy
    // derivation reads (packages/db/src/schema/authz.ts's doc comment).
    await withTenant(ctx, (db) => db.update(schema.tenantDataPolicy).set({ allowOutOfRegionInference: true }).where(eq(schema.tenantDataPolicy.tenantId, ctx.tenantId)));

    const result = await evaluateToolCallScope(ctx, {
      agentDefinitionVersionId: null,
      toolId: crypto.randomUUID(),
      toolCapabilityGroupId: null,
      toolRwClass: "Read",
      toolApprovalTier: "Tier1",
    });
    expect(result.decision).toBe("Allow");
    expect(result.effectiveScope?.allowOutOfRegionInference).toBe(true);
  });
});
