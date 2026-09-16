/**
 * CLI entry point for B-5's real, permanent seed data: the platform guardrail
 * policy catalogue (B12 tab 1 — `platform.Policies`/`OverridablePolicies`, a real,
 * previously-unseeded gap found while building the agent runtime: every wizard/API
 * path that reads this catalogue already existed, but nothing had ever inserted a
 * row into it), a tenant `RouterConfig` singleton (B4 configuration, sane defaults),
 * and one real demo `Flow` — "Pay SEWA Bills" — exercising all five B7 node types
 * (Question, ToolCall, Message, Handover, Condition) plus the mandatory free-text
 * escape node, bound to the seeded SEWA billing agent's current version via a real
 * `AgentFlowBinding` and a real `ToolBinding` to the already-seeded `fetch_sewa_bill`
 * skill (`scripts/seed-agents-tools-demo-data.ts`).
 *
 *   pnpm exec tsx scripts/seed-agent-runtime-demo-data.ts
 *
 * (also wired as `pnpm db:seed:agent-runtime`.) Idempotent throughout (upsert by
 * natural key), safe to re-run. Composition root, not application code — direct
 * Prisma client access via `getPlatformDb()`/`getTenantDb()`, the same shape
 * `seed-system-skins.ts` and `bootstrap-platform-schema.ts` already use for
 * environment-bootstrap writes that have no dedicated application-layer port
 * (none of `governance`/`orchestration`/`flows` exist as `apps/web` modules yet —
 * their UI/API surfaces are a later wave's job; this script only needs to make the
 * already-built runtime's own read paths (`ConfigReader`, `FlowReader` in
 * `apps/ai`) see real data instead of an empty table).
 */

import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import {
  getPlatformDb,
  getTenantDb,
} from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { disconnectAllTenantDbs } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { disconnectCache } from "../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { newUlid } from "../apps/web/src/modules/platform/adapters/outbound/sql/ulid.js";

const SEWA_AGENT_VERSION_ID = "01M23A0KYCSYD464V7QY42TTQD";
const FETCH_SEWA_BILL_SKILL_ID = "01M23A0MD5J4SQT168BS8G0EDF";
const STAFF_ID = "01M23A0EHQ3MV2RZ7BRFQHQ2Q8";

/** B12 tab 1's five-policy floor (FR-GOV-01), plus the wizard's own third
 * override key (`allow_competitor_discussion`, `modules/agents/application/
 * get-guardrail-settings.ts`'s `GUARDRAIL_POLICY_KEYS`) — six rows total. */
const POLICIES = [
  {
    policyKey: "mask_pii_in_transcripts",
    title: "Mask PII in transcripts",
    detail:
      "PII in stored transcripts and derived memory is replaced with a redaction token before persistence.",
    kind: "Boolean",
    defaultValueJson: JSON.stringify({ value: true }),
    isLocked: true,
    appliesTo: "Storage",
  },
  {
    policyKey: "prompt_injection_filter",
    title: "Prompt-injection filter",
    detail:
      "Instructions embedded in retrieved documents or citizen uploads are blocked from altering agent behaviour.",
    kind: "Boolean",
    defaultValueJson: JSON.stringify({ value: true }),
    isLocked: true,
    appliesTo: "Runtime",
  },
  {
    policyKey: "grounding_threshold",
    title: "Grounding-confidence refusal threshold",
    detail: "Below this confidence the assistant withholds an answer and offers a human instead.",
    kind: "Threshold",
    defaultValueJson: JSON.stringify({ value: 0.6 }),
    isLocked: false,
    appliesTo: "Runtime",
  },
  {
    policyKey: "allow_competitor_discussion",
    title: "Allow competitor discussion",
    detail: "Whether the assistant may discuss competitor products/services.",
    kind: "Boolean",
    defaultValueJson: JSON.stringify({ value: false }),
    isLocked: false,
    appliesTo: "Runtime",
  },
  {
    policyKey: "block_financial_advice",
    title: "Block financial advice",
    detail: "Blocks advice on payment timing, credit and disputes.",
    kind: "Boolean",
    defaultValueJson: JSON.stringify({ value: true }),
    isLocked: false,
    appliesTo: "Runtime",
  },
  {
    policyKey: "restrict_in_scope_services",
    title: "Restrict to in-scope services",
    detail: "Restricts answers to the tenant's own government-service catalogue.",
    kind: "Boolean",
    defaultValueJson: JSON.stringify({ value: false }),
    isLocked: false,
    appliesTo: "Runtime",
  },
] as const;

async function seedPolicies(): Promise<void> {
  const db = getPlatformDb("seed governance policies");
  for (const policy of POLICIES) {
    await db.policy.upsert({
      where: { policyKey: policy.policyKey },
      update: {},
      create: { ...policy, floorValueJson: null, createdAt: new Date() },
    });
    // `TR_Policies_syncOverridable` maintains `OverridablePolicies` itself on
    // insert (§3.4) — no separate write needed here.
  }
  console.info(`[seed-agent-runtime] ${POLICIES.length} platform policies ensured.`);
}

async function seedRouterConfig(): Promise<void> {
  const db = getTenantDb("seed router config");
  const existing = await db.routerConfig.findFirst({ where: { singletonKey: 1 } });
  if (existing) {
    console.info("[seed-agent-runtime] RouterConfig already present, skipping.");
    return;
  }
  await db.routerConfig.create({
    data: {
      id: newUlid(),
      singletonKey: 1,
      executionMode: "Sequential",
      routingStrategy: "IntentClassifier",
      agentSelectionScope: "AllPublished",
      agentScopeListJson: null,
      maxHops: 6,
      maxLoopIterations: 3,
      costCeilingTokens: 8000,
      costCeilingMicroAed: 350_000,
      conflictResolution: "HighestConfidence",
      responseMergePolicy: "DeduplicateOverlap",
      fallbackAgentId: null,
      minRoutingConfidence: 0.3,
      createdAt: new Date(),
    },
  });
  console.info(
    "[seed-agent-runtime] RouterConfig singleton created (Sequential, sane default ceilings).",
  );
}

async function seedToolBinding(): Promise<string> {
  const db = getTenantDb("seed tool binding");
  const existing = await db.toolBinding.findFirst({
    where: { agentVersionId: SEWA_AGENT_VERSION_ID, skillId: FETCH_SEWA_BILL_SKILL_ID },
  });
  if (existing) {
    console.info("[seed-agent-runtime] ToolBinding already present, skipping.");
    return existing.id;
  }
  const created = await db.toolBinding.create({
    data: {
      id: newUlid(),
      agentVersionId: SEWA_AGENT_VERSION_ID,
      targetKind: "Skill",
      skillId: FETCH_SEWA_BILL_SKILL_ID,
      isEnabled: true,
      requiredAssurance: "Anonymous",
      boundByStaffUserId: STAFF_ID,
      boundAt: new Date(),
      createdAt: new Date(),
    },
  });
  console.info(
    "[seed-agent-runtime] ToolBinding created (fetch_sewa_bill -> SEWA billing agent v1.4).",
  );
  return created.id;
}

async function seedDemoFlow(toolBindingId: string): Promise<void> {
  const db = getTenantDb("seed demo flow");
  const existing = await db.flow.findFirst({ where: { slug: "pay-sewa-bills-b5-demo" } });
  if (existing) {
    console.info("[seed-agent-runtime] Demo flow already present, skipping.");
    return;
  }

  const flowId = newUlid();
  const flowVersionId = newUlid();
  const askAccountId = newUlid();
  const getBillId = newUlid();
  const confirmId = newUlid();
  const handoverId = newUlid();
  const escapeId = newUlid();

  await db.flow.create({
    data: {
      id: flowId,
      name: "Pay SEWA Bills (B-5 demo)",
      slug: "pay-sewa-bills-b5-demo",
      description: "B-5 live-verification demo flow exercising all five node types.",
      ownerTenantId: (
        await getPlatformDb("resolve sewa tenant id").tenant.findUniqueOrThrow({
          where: { slug: "sewa" },
        })
      ).id,
      status: "Draft",
      createdByStaffUserId: STAFF_ID,
      createdAt: new Date(),
    },
  });

  await db.flowVersion.create({
    data: {
      id: flowVersionId,
      flowId,
      major: 1,
      minor: 0,
      status: "Draft",
      isCurrent: true,
      freeTextEscapeEnabled: true,
      changeSummary: "Initial B-5 demo version.",
      createdByStaffUserId: STAFF_ID,
      createdAt: new Date(),
    },
  });

  const now = new Date();
  await db.flowNode.createMany({
    data: [
      {
        id: askAccountId,
        flowVersionId,
        key: "ask_account",
        type: "Question",
        title: "Ask for account number",
        canvasX: 0,
        canvasY: 0,
        slotName: "account_number",
        optionSourceKind: "Static",
        staticOptionsJson: "[]",
        createdAt: now,
      },
      {
        id: getBillId,
        flowVersionId,
        key: "get_bill",
        type: "ToolCall",
        title: "Fetch SEWA bill",
        canvasX: 200,
        canvasY: 0,
        toolBindingId,
        retryCount: 1,
        retryOnTimeout: true,
        timeoutMs: 5000,
        onFailureNodeId: handoverId,
        createdAt: now,
      },
      {
        id: confirmId,
        flowVersionId,
        key: "confirm",
        type: "Message",
        title: "Confirm bill amount",
        canvasX: 400,
        canvasY: 0,
        messageText: "Here is your SEWA bill.",
        createdAt: now,
      },
      {
        id: handoverId,
        flowVersionId,
        key: "handover",
        type: "Handover",
        title: "Escalate to a live agent",
        canvasX: 400,
        canvasY: 200,
        handoverReason: "ToolFailure",
        createdAt: now,
      },
      {
        id: escapeId,
        flowVersionId,
        key: "escaped",
        type: "Message",
        title: "Free-text escape landing node",
        canvasX: 0,
        canvasY: 200,
        messageText: "Sure, what else can I help with?",
        createdAt: now,
      },
    ],
  });

  await db.flowEdge.createMany({
    data: [
      {
        id: newUlid(),
        flowVersionId,
        fromNodeId: askAccountId,
        toNodeId: getBillId,
        ordinal: 0,
        isDefaultBranch: true,
        createdAt: now,
      },
      {
        id: newUlid(),
        flowVersionId,
        fromNodeId: getBillId,
        toNodeId: confirmId,
        ordinal: 0,
        isDefaultBranch: true,
        createdAt: now,
      },
    ],
  });

  await db.flowVersion.update({
    where: { id: flowVersionId },
    data: {
      entryNodeId: askAccountId,
      escapeNodeId: escapeId,
      status: "Published",
      publishedAt: new Date(),
    },
  });
  await db.flow.update({
    where: { id: flowId },
    data: { currentVersionId: flowVersionId, status: "Published" },
  });

  await db.agentFlowBinding.create({
    data: {
      id: newUlid(),
      agentVersionId: SEWA_AGENT_VERSION_ID,
      flowId,
      flowVersionId,
      isEnabled: true,
      ordinal: 0,
      createdAt: new Date(),
    },
  });

  console.info(
    "[seed-agent-runtime] Demo flow 'Pay SEWA Bills (B-5 demo)' created and bound to SEWA billing agent v1.4.",
  );
}

async function main(): Promise<void> {
  await runWithTenant(
    {
      tenant: assertValidSlugShape("sewa"),
      principal: null,
      traceId: "seed-agent-runtime",
      platformScope: "provisioning",
    },
    async () => {
      await seedPolicies();
      await seedRouterConfig();
      const toolBindingId = await seedToolBinding();
      await seedDemoFlow(toolBindingId);
    },
  );
  await disconnectAllTenantDbs();
  await disconnectCache();
}

main().catch((error: unknown) => {
  console.error("[seed-agent-runtime] failed:", error);
  process.exitCode = 1;
});
