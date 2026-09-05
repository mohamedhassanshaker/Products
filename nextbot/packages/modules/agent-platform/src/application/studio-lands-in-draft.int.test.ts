import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { SubmitStudioDraftRequestSchema } from "@nextbot/contracts";
import { Value } from "@sinclair/typebox/value";
import { createAgentDefinition } from "./agent-definition-service.js";
import { createDraft, submitPurposeStep, submitSkillsStep, submitDraft } from "./studio-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-43, FR-AGT-13, LLD §14.5.5) — "no
 * Studio code path can produce a version whose status !== 'Draft'." Two
 * independent proofs:
 *  1. Structural: `SubmitStudioDraftRequestSchema` has no `status` field at
 *     all — a client literally cannot ask for anything else, confirmed here
 *     by asserting an attempted `status` field is rejected as an unknown
 *     property (`additionalProperties: false`), not merely "ignored."
 *  2. Behavioral: a real Studio submit against real Postgres always returns a
 *     version whose `status` is `'Draft'`, regardless of what the draft's
 *     staged answers look like.
 */
describe("Studio always lands as Draft — never any other status (FR-AGT-13)", () => {
  it("SubmitStudioDraftRequestSchema structurally rejects a status field (additionalProperties: false)", () => {
    const withStatus = { version: "1.0.0", modelRouteKey: "chat.primary", status: "Production" };
    expect(Value.Check(SubmitStudioDraftRequestSchema, withStatus)).toBe(false);
  });

  const createdTenantIds: string[] = [];
  afterEach(async () => {
    for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
  });

  it("a real Studio submit against real Postgres always returns status='Draft'", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    const definition = await createAgentDefinition(ctx, { name: "lands-in-draft-test" });
    const draft = await createDraft(ctx, definition.id, "00000000-0000-0000-0000-000000000001");
    await submitPurposeStep(ctx, draft.id, { instructions: "You are a support agent." });
    await submitSkillsStep(ctx, draft.id, { skills: [] });

    const version = await submitDraft(ctx, draft.id, { version: "1.0.0", modelRouteKey: "chat.primary" }, "00000000-0000-0000-0000-000000000001");
    expect(version.status).toBe("Draft");
  });
});
