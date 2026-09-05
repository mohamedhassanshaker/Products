import { afterEach, describe, expect, it } from "vitest";
import { createFixtureTenant, deleteFixtureTenant } from "@nextbot/db/testing";
import type { TenantContext } from "@nextbot/db";
import type { AgentDefinitionArtifact } from "@nextbot/contracts";
import { createSkill, createSkillVersion, publishVersion } from "@nextbot/skills";
import { createAgentDefinition, createAgentDefinitionVersion } from "./agent-definition-service.js";
import { updateAgentDefinitionVersionStatus, getAgentDefinitionVersion } from "../infrastructure/agent-definition-repository.js";
import { getSkillWhereUsed, upgradeConsumers } from "./skill-upgrade-service.js";

/**
 * Target Architecture Blueprint Phase 5 (BL-35, ADR-0015 §2.3/§2.4, LLD §14.5.4) —
 * real-Postgres proof of the where-used index and the "upgrade consumers" action:
 * immutability of every existing consumer version, idempotency of a re-run, and
 * that every generated draft actually lands as `Draft` (never auto-promoted).
 */

function artifactWithSkillPin(pin: string): AgentDefinitionArtifact {
  return {
    apiVersion: "nextbot.io/v1",
    kind: "AgentDefinition",
    metadata: { name: "skill-upgrade-consumer", version: "1.0.0" },
    spec: {
      graphType: "ADK",
      modelRoute: "chat.primary",
      instructions: "You are a test agent.",
      toolPolicy: { source: "agent-tool-registry", capabilityGroups: [], maxToolCallsPerTurn: 5 },
      guardrails: { minConfidenceForAutonomy: 0.6, escalateOn: [] },
      memory: { strategy: "rolling-window", maxTurns: 20 },
      budgets: { maxCostUsdPerConversation: "0.50", maxLatencyMsP95: 6000 },
      skills: [pin],
    },
  };
}

const SYSTEM_ACTOR = "00000000-0000-4000-8000-0000000000aa";

async function makePublishedSkill(ctx: TenantContext, name: string) {
  const { skill, version } = await createSkill(
    ctx,
    {
      name,
      artifact: {
        kind: "skill",
        name,
        version: 1,
        trigger: "customer asks to reverse a completed payment",
        scope: { capabilityGroups: [], tools: [], knowledge: [] },
        instructions: "Confirm the invoice and the amount before refunding.",
        successCriteria: "refund issued, or a stated reason why not",
        escalateWhen: ["amount > 500"],
        evalCases: [],
      },
    },
    SYSTEM_ACTOR,
  );
  const published = await publishVersion(ctx, version.id, SYSTEM_ACTOR);
  return { skill, version: published };
}

/** Creates an agent definition with one version pinned to `skillPin`, promoted out
 * of Draft (directly via the repository, bypassing the full eval/reviewer gate —
 * this test is about upgrade-consumers mechanics, not the promotion gate itself,
 * exactly like every other agent-platform fixture that only needs "not Draft"). */
async function makeConsumer(ctx: TenantContext, name: string, skillPin: string) {
  const definition = await createAgentDefinition(ctx, { name });
  const version = await createAgentDefinitionVersion(ctx, definition.id, { version: "1.0.0", modelRouteKey: "chat.primary", artifact: artifactWithSkillPin(skillPin) }, null);
  await updateAgentDefinitionVersionStatus(ctx, version.id, { status: "Production" });
  return { definition, version };
}

describe("skill where-used + upgrade-consumers (ADR-0015, real Postgres)", () => {
  let ctx: TenantContext;
  afterEach(async () => {
    if (ctx) await deleteFixtureTenant(ctx.tenantId);
  });

  it("where-used reports accurate consumer counts/pins, and upgrade-consumers re-pins every stale consumer to a new Draft without mutating any existing version", async () => {
    ctx = await createFixtureTenant();
    const { skill } = await makePublishedSkill(ctx, "refund_request");

    const consumerA = await makeConsumer(ctx, "consumer-a", "refund_request@1");
    const consumerB = await makeConsumer(ctx, "consumer-b", "refund_request@1");
    const consumerC = await makeConsumer(ctx, "consumer-c", "refund_request@1");

    // Bump the skill to version 2.
    const v2 = await createSkillVersion(ctx, skill.id, {
      kind: "skill",
      name: "refund_request",
      version: 2,
      trigger: "customer asks to reverse a completed payment",
      scope: { capabilityGroups: [], tools: [], knowledge: [] },
      instructions: "Confirm the invoice and the amount before refunding. Escalate disputes.",
      successCriteria: "refund issued, or a stated reason why not",
      escalateWhen: ["amount > 500", "customer disputes a second time"],
      evalCases: [],
    }, SYSTEM_ACTOR);
    await publishVersion(ctx, v2.id, SYSTEM_ACTOR);

    const whereUsed = await getSkillWhereUsed(ctx, skill.id);
    expect(whereUsed.currentPublishedVersion).toBe(2);
    expect(whereUsed.consumers).toHaveLength(3);
    for (const c of whereUsed.consumers) {
      expect(c.pinnedSkillVersion).toBe(1);
      expect(c.behindBy).toBe(1);
      expect(c.pendingUpgradeDraftId).toBeNull();
    }

    // Run "upgrade consumers" against the new version — all 3 consumers are stale.
    const result = await upgradeConsumers(ctx, skill.id, { toSkillVersionId: v2.id }, SYSTEM_ACTOR);
    expect(result.created).toHaveLength(3);
    expect(result.skipped).toHaveLength(0);

    // Every generated draft is a genuine Draft — never auto-promoted.
    for (const created of result.created) {
      const draftRow = await getAgentDefinitionVersion(ctx, created.newDraftVersionId);
      expect(draftRow.status).toBe("Draft");
      expect(draftRow.upgradeSourceVersionId).not.toBeNull();
      expect(draftRow.upgradedSkillVersionId).toBe(v2.id);
    }

    // NONE of the three original (Production) consumer versions were mutated.
    for (const consumer of [consumerA, consumerB, consumerC]) {
      const reread = await getAgentDefinitionVersion(ctx, consumer.version.id);
      expect(reread.definitionYaml).toBe(consumer.version.definitionYaml);
      expect(reread.definitionHash).toBe(consumer.version.definitionHash);
      expect(reread.status).toBe("Production");
    }

    // Idempotency: running it again creates nothing new — every consumer already
    // has a pending (still-Draft) upgrade draft.
    const secondRun = await upgradeConsumers(ctx, skill.id, { toSkillVersionId: v2.id }, SYSTEM_ACTOR);
    expect(secondRun.created).toHaveLength(0);
    expect(secondRun.skipped).toHaveLength(3);
    expect(secondRun.skipped.every((s) => s.reason === "PendingUpgradeDraftExists")).toBe(true);

    // The now-reflected where-used panel shows the pending drafts.
    const whereUsedAfter = await getSkillWhereUsed(ctx, skill.id);
    expect(whereUsedAfter.consumers.every((c) => c.pendingUpgradeDraftId !== null)).toBe(true);
  });

  it("dryRun reports what would happen without writing anything", async () => {
    ctx = await createFixtureTenant();
    const { skill } = await makePublishedSkill(ctx, "refund_request_dryrun");
    const consumer = await makeConsumer(ctx, "consumer-dryrun", "refund_request_dryrun@1");

    const v2 = await createSkillVersion(
      ctx,
      skill.id,
      {
        kind: "skill",
        name: "refund_request_dryrun",
        version: 2,
        trigger: "customer asks to reverse a completed payment",
        scope: { capabilityGroups: [], tools: [], knowledge: [] },
        instructions: "Updated.",
        successCriteria: "refund issued, or a stated reason why not",
        escalateWhen: [],
        evalCases: [],
      },
      SYSTEM_ACTOR,
    );
    await publishVersion(ctx, v2.id, SYSTEM_ACTOR);

    const result = await upgradeConsumers(ctx, skill.id, { toSkillVersionId: v2.id, dryRun: true }, SYSTEM_ACTOR);
    expect(result.created).toHaveLength(1);
    expect(result.created[0]?.newDraftVersionId).toBe("dry-run");

    // Nothing was actually written — the consumer's own version is unchanged and
    // no new version exists for its definition.
    const reread = await getAgentDefinitionVersion(ctx, consumer.version.id);
    expect(reread.definitionYaml).toBe(consumer.version.definitionYaml);
    const whereUsed = await getSkillWhereUsed(ctx, skill.id);
    expect(whereUsed.consumers.find((c) => c.consumerId === consumer.version.id)?.pendingUpgradeDraftId).toBeNull();
  });

  it("a Deprecated consumer head version is skipped with ConsumerDeprecated, not silently upgraded", async () => {
    ctx = await createFixtureTenant();
    const { skill } = await makePublishedSkill(ctx, "refund_request_deprecated");
    const consumer = await makeConsumer(ctx, "consumer-deprecated-head", "refund_request_deprecated@1");
    await updateAgentDefinitionVersionStatus(ctx, consumer.version.id, { status: "Deprecated" });

    const v2 = await createSkillVersion(
      ctx,
      skill.id,
      {
        kind: "skill",
        name: "refund_request_deprecated",
        version: 2,
        trigger: "customer asks to reverse a completed payment",
        scope: { capabilityGroups: [], tools: [], knowledge: [] },
        instructions: "Updated.",
        successCriteria: "refund issued, or a stated reason why not",
        escalateWhen: [],
        evalCases: [],
      },
      SYSTEM_ACTOR,
    );
    await publishVersion(ctx, v2.id, SYSTEM_ACTOR);

    const result = await upgradeConsumers(ctx, skill.id, { toSkillVersionId: v2.id }, SYSTEM_ACTOR);
    expect(result.created).toHaveLength(0);
    expect(result.skipped).toEqual([{ consumerId: consumer.version.id, reason: "ConsumerDeprecated" }]);
  });

  it("real skill_version_immutable trigger rejects a raw UPDATE to any non-exempt column", async () => {
    ctx = await createFixtureTenant();
    const { version } = await makePublishedSkill(ctx, "refund_request_immutable");

    const { withTenant } = await import("@nextbot/db");
    await expect(
      withTenant(ctx, async (db) => {
        const { sql } = await import("drizzle-orm");
        await db.execute(sql`UPDATE skill_version SET instructions = 'tampered' WHERE id = ${version.id}`);
      }),
    ).rejects.toThrow(/SKILL_VERSION_IMMUTABLE/);
  });
});
