import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { setPiiPolicy } from "@nextbot/pii";
import { GuardrailLoosenedError, type AgentDefinitionArtifact } from "@nextbot/contracts";
import { createAgentDefinition, createAgentDefinitionVersion } from "./agent-definition-service.js";
import { listAgentDefinitionVersions } from "../infrastructure/agent-definition-repository.js";
import { createDraft, submitGuardrailsStep, submitPurposeStep, submitDraft } from "./studio-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43/44, FR-AGT-14, LLD §14.5.6) —
 * a REAL, adversarial, Postgres-backed proof that the guardrail
 * tightening-only invariant is enforced identically for Text/Design mode
 * (both funnel through `createAgentDefinitionVersion` directly — this is the
 * exact same code path a client-side-validated Text/Design artifact reaches
 * server-side) and Studio mode (via `studio-service.ts#submitDraft`), and that
 * the rejection blocks **saving as Draft**, not merely a later promotion
 * check — a rejected save never creates any version row at all.
 */
const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

function baseArtifact(overrides: Partial<AgentDefinitionArtifact["spec"]> = {}): AgentDefinitionArtifact {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "AgentDefinition",
    metadata: { name: "guardrail-tightening-test", version: "1.0.0" },
    spec: {
      graphType: "ADK",
      modelRoute: "chat.primary",
      instructions: "You are a support agent.",
      toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
      ...overrides,
    },
  };
}

describe("FR-AGT-14 guardrail tightening-only — real Postgres, Text/Design-equivalent path (createAgentDefinitionVersion directly)", () => {
  it("REJECTS a version attempting to loosen spec.maskingFloor.Transcript from the tenant's real FullMask floor to Show, and creates NO version row at all", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await setPiiPolicy(ctx, "Email", "Transcript", "SemiTrusted", "FullMask");

    const definition = await createAgentDefinition(ctx, { name: "guardrail-def-1" });

    await expect(
      createAgentDefinitionVersion(
        ctx,
        definition.id,
        { version: "1.0.0", modelRouteKey: "chat.primary", artifact: baseArtifact({ maskingFloor: { Transcript: "Show" } }) },
        null,
      ),
    ).rejects.toBeInstanceOf(GuardrailLoosenedError);

    // Blocks SAVING AS DRAFT, not merely a later promotion check — no version
    // row was ever created for this rejected attempt.
    const versions = await listAgentDefinitionVersions(ctx, definition.id);
    expect(versions).toHaveLength(0);
  });

  it("ALLOWS a version that tightens spec.maskingFloor.Transcript beyond the tenant's real PartialMask floor, landing as Draft", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await setPiiPolicy(ctx, "Email", "Transcript", "SemiTrusted", "PartialMask");

    const definition = await createAgentDefinition(ctx, { name: "guardrail-def-2" });
    const version = await createAgentDefinitionVersion(
      ctx,
      definition.id,
      { version: "1.0.0", modelRouteKey: "chat.primary", artifact: baseArtifact({ maskingFloor: { Transcript: "Redact" } }) },
      null,
    );
    expect(version.status).toBe("Draft");
  });

  it("ALLOWS a version that declares no maskingFloor at all (⊤ — no additional constraint), regardless of the tenant floor", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await setPiiPolicy(ctx, "Email", "Transcript", "SemiTrusted", "FullMask");

    const definition = await createAgentDefinition(ctx, { name: "guardrail-def-3" });
    const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", artifact: baseArtifact() }, null);
    expect(version.status).toBe("Draft");
  });
});

describe("FR-AGT-14 guardrail tightening-only — real Postgres, Studio mode path (studio-service.ts#submitDraft)", () => {
  it("REJECTS the identical loosening attempt when authored via the Studio wizard, proving it is the SAME enforcement, not a Studio-only check", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await setPiiPolicy(ctx, "Email", "Transcript", "SemiTrusted", "FullMask");

    const definition = await createAgentDefinition(ctx, { name: "guardrail-def-studio-1" });
    const draft = await createDraft(ctx, definition.id, "00000000-0000-0000-0000-000000000001");
    await submitPurposeStep(ctx, draft.id, { instructions: "You are a support agent." });
    await submitGuardrailsStep(ctx, draft.id, { minConfidenceForAutonomy: 0.6, escalateOn: [], maskingFloor: { Transcript: "Show" } });

    await expect(
      submitDraft(ctx, draft.id, { version: "1.0.0", modelRouteKey: "chat.primary" }, "00000000-0000-0000-0000-000000000001"),
    ).rejects.toBeInstanceOf(GuardrailLoosenedError);

    const versions = await listAgentDefinitionVersions(ctx, definition.id);
    expect(versions).toHaveLength(0);
  });
});
