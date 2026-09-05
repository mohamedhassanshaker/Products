import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import { createConnector } from "@nextbot/connectors";
import { upsertToolFromDiscovery, createCapabilityGroup } from "@nextbot/tool-registry";
import type { SkillArtifact } from "@nextbot/contracts";
import { SkillNotFoundError, SkillReferenceNotFoundError, SkillVersionNotFoundError, SkillVersionStatusInvalidError } from "@nextbot/contracts";
import {
  createSkill,
  createSkillVersion,
  publishVersion,
  deprecateVersion,
  structuralDiffVersions,
  listVersions,
  listSkills,
  listSkillsForLibrary,
  resolveSkillPin,
} from "./skill-service.js";
import { getSkillVersion } from "../infrastructure/skill-repository.js";
import { hashSkillArtifact } from "../domain/skill-hash.js";

const createdTenantIds: string[] = [];
afterEach(async () => {
  for (const id of createdTenantIds.splice(0)) await deleteFixtureTenant(id);
});

async function makeFixtureRefs(ctx: Awaited<ReturnType<typeof createFixtureTenant>>) {
  const connector = await createConnector(ctx, {
    name: "billing_core",
    backendType: "Custom",
    transport: "StreamableHTTP",
    endpointUrl: "https://billing.example.com/mcp",
    authMethod: "None",
    environment: "Sandbox",
  });
  await upsertToolFromDiscovery(ctx, {
    connectorId: connector.id,
    name: "payment.refund",
    descriptionSource: "Refund a payment",
    rwClass: "Write",
    approvalTier: "Tier2",
    inputSchema: { type: "object" },
    outputSchema: { type: "object" },
  });
  const capabilityGroupId = await createCapabilityGroup(ctx, { name: "billing" });
  return { connector, capabilityGroupId };
}

function baseArtifact(overrides: Partial<SkillArtifact> = {}): SkillArtifact {
  return {
    kind: "skill",
    name: "refund_request",
    version: 1,
    trigger: "customer asks to reverse a completed payment",
    scope: {
      capabilityGroups: ["billing"],
      tools: ["payment.refund@billing_core"],
      knowledge: ["billing_policy"],
    },
    instructions: "Confirm the invoice and the amount before refunding. Never refund more than the original charge.",
    successCriteria: "refund issued, or a stated reason why not",
    escalateWhen: ["amount > 500", "customer disputes a second time"],
    evalCases: ["ec_refund_happy", "ec_refund_partial"],
    ...overrides,
  };
}

describe("skill-service (BL-35, ADR-0015, real Postgres)", () => {
  it("creates a skill with a real version 1, resolving scope references to real ids", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await makeFixtureRefs(ctx);

    const { skill, version } = await createSkill(ctx, { name: "refund_request", artifact: baseArtifact() }, "00000000-0000-4000-8000-000000000001");

    expect(skill.name).toBe("refund_request");
    expect(version.version).toBe(1);
    expect(version.status).toBe("Draft");
    expect(version.scopeCapabilityGroupIds).toHaveLength(1);
    expect(version.scopeToolIds).toHaveLength(1);
    expect(version.scopeKnowledgeCollectionNames).toEqual(["billing_policy"]);
    expect(version.yamlHash).toBe(hashSkillArtifact({ ...baseArtifact(), version: 1 }));
  });

  it("FR-AGT-11: fails at save with the specific missing reference named, and persists nothing", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await makeFixtureRefs(ctx);

    const artifact = baseArtifact({ scope: { capabilityGroups: ["billing"], tools: ["payment.void@billing_core"], knowledge: [] } });
    await expect(createSkill(ctx, { name: "refund_request", artifact }, "00000000-0000-4000-8000-000000000001")).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(SkillReferenceNotFoundError);
      const e = err as SkillReferenceNotFoundError;
      expect(e.fields?.[0]?.path).toBe("scope.tools[0]");
      expect(e.message).toContain("payment.void@billing_core");
      return true;
    });

    const allSkills = await listSkills(ctx);
    expect(allSkills.find((s) => s.name === "refund_request")).toBeUndefined();
  });

  it("immutability: creating version 2 leaves version 1 byte-for-byte unchanged and its hash still matches", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await makeFixtureRefs(ctx);

    const { skill, version: v1 } = await createSkill(ctx, { name: "refund_request", artifact: baseArtifact() }, "00000000-0000-4000-8000-000000000001");
    const v2 = await createSkillVersion(ctx, skill.id, baseArtifact({ instructions: "Updated instructions after policy change." }), "00000000-0000-4000-8000-000000000001");

    expect(v2.version).toBe(2);
    expect(v2.id).not.toBe(v1.id);

    // Re-read v1 fresh from the DB — must be byte-for-byte identical to what was
    // originally returned, and its stored hash must still match a fresh recompute
    // of its own (unchanged) yaml content.
    const v1Reread = await getSkillVersion(ctx, v1.id);
    expect(v1Reread.yaml).toBe(v1.yaml);
    expect(v1Reread.instructions).toBe(v1.instructions);
    expect(v1Reread.yamlHash).toBe(v1.yamlHash);

    const versions = await listVersions(ctx, skill.id);
    expect(versions.map((v) => v.version).sort()).toEqual([1, 2]);
  });

  it("publish/deprecate only ever touch the exempt columns — status ladder is Draft -> Published -> Deprecated", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await makeFixtureRefs(ctx);
    const { version } = await createSkill(ctx, { name: "refund_request", artifact: baseArtifact() }, "00000000-0000-4000-8000-000000000001");

    const published = await publishVersion(ctx, version.id, "00000000-0000-4000-8000-000000000002");
    expect(published.status).toBe("Published");
    expect(published.publishedByUserId).toBe("00000000-0000-4000-8000-000000000002");
    expect(published.yaml).toBe(version.yaml);

    await expect(publishVersion(ctx, version.id, "00000000-0000-4000-8000-000000000002")).rejects.toBeInstanceOf(SkillVersionStatusInvalidError);

    const deprecated = await deprecateVersion(ctx, version.id, "superseded");
    expect(deprecated.status).toBe("Deprecated");
    expect(deprecated.deprecationNote).toBe("superseded");
  });

  it("ADR-0016/FR-AGT-19: structural diff between two skill versions via @nextbot/yaml-diff", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await makeFixtureRefs(ctx);
    const { skill, version: v1 } = await createSkill(ctx, { name: "refund_request", artifact: baseArtifact() }, "00000000-0000-4000-8000-000000000001");
    const v2 = await createSkillVersion(ctx, skill.id, baseArtifact({ escalateWhen: ["amount > 500"] }), "00000000-0000-4000-8000-000000000001");

    const changeSet = await structuralDiffVersions(ctx, v1.id, v2.id);
    expect(changeSet.length).toBeGreaterThan(0);
    // escalateWhen is declared "set" mode — removing "customer disputes a second
    // time" must show as a real change, not get swallowed by reordering logic.
    const escalateChange = changeSet.find((c) => c.path.startsWith("escalateWhen"));
    expect(escalateChange).toBeDefined();
  });

  it("Skills Library list summary: version count, latest/published version number, and trigger summary", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await makeFixtureRefs(ctx);
    const { skill, version: v1 } = await createSkill(ctx, { name: "refund_request", artifact: baseArtifact() }, "00000000-0000-4000-8000-000000000001");
    await createSkillVersion(ctx, skill.id, baseArtifact({ trigger: "an updated trigger description" }), "00000000-0000-4000-8000-000000000001");
    await publishVersion(ctx, v1.id, "00000000-0000-4000-8000-000000000001");

    const list = await listSkillsForLibrary(ctx);
    const row = list.find((s) => s.id === skill.id);
    expect(row?.versionCount).toBe(2);
    // v1 is Published, v2 is still Draft — the Published version wins over the
    // merely-newer Draft as the "current" one the list/composer offers.
    expect(row?.latestVersionNumber).toBe(1);
    expect(row?.triggerSummary).toBe(baseArtifact().trigger);
  });

  it("ADR-0015 §2.1: resolveSkillPin resolves an exact 'name@version' pin to the real skill_version row", async () => {
    const ctx = await createFixtureTenant();
    createdTenantIds.push(ctx.tenantId);
    await makeFixtureRefs(ctx);
    const { skill, version } = await createSkill(ctx, { name: "refund_request", artifact: baseArtifact() }, "00000000-0000-4000-8000-000000000001");

    const resolved = await resolveSkillPin(ctx, "refund_request@1");
    expect(resolved).toEqual({ skillId: skill.id, skillVersionId: version.id, skillName: "refund_request", version: 1 });

    await expect(resolveSkillPin(ctx, "refund_request@99")).rejects.toBeInstanceOf(SkillVersionNotFoundError);
    await expect(resolveSkillPin(ctx, "no_such_skill@1")).rejects.toBeInstanceOf(SkillNotFoundError);
    await expect(resolveSkillPin(ctx, "malformed-pin-no-at-sign")).rejects.toBeInstanceOf(SkillVersionNotFoundError);
  });
});
