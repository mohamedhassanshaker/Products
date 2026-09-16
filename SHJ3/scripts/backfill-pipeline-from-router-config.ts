/**
 * Backfills a synthesized `v1.0` Published pipeline per tenant from its current, real, flat
 * `RouterConfigs` singleton (§7 of the Pipeline Designer's own design) — modeled on
 * `scripts/backfill-default-router-config.ts`'s identical per-tenant, idempotent,
 * `--dry-run`-capable shape.
 *
 * The synthesized graph, per `RouterConfigs.executionMode`:
 *  - `Sequential` -> `Start` -> primary (turn-bound) -> `Response`.
 *  - `Parallel` -> `Start` fans to primary (turn-bound) + one secondary (pinned) ->
 *    `Response` (a real join, using the tenant's real merge/conflict policy).
 *  - `SupervisorWorker` -> `Start` -> up to two workers (pinned), chained SEQUENTIALLY, ->
 *    supervisor (turn-bound, `UpstreamRepliesSummary`) -> `Response` — matching today's
 *    actual sequential-worker execution exactly (`process_turn.py`'s own dispatcher never
 *    parallelizes workers), not a richer graph nobody configured.
 *
 * `ExplicitList`'s named agents are pinned faithfully, in list order. `AllPublished`/
 * `ChannelBound` pin a deterministic top-N by slug instead — the one unavoidable, disclosed
 * behaviour change this design's own doc comment names (today's per-turn keyword-score
 * secondary selection becomes a fixed pin). This script does not yet write the one-time
 * `PipelineVersionHistoryEntry`/banner surfacing that disclosure in the UI (a real, disclosed
 * scope trim for this pass — the console summary below states it plainly instead).
 *
 * The synthesized version's own ceilings/policies are set from the tenant's REAL
 * `RouterConfigs` row (`PipelineRepository.updateVersionSettings`), never left at this
 * repository's generic create-time defaults — a hardcoded default looser or tighter than
 * what the tenant actually had configured would silently change its real ceilings the
 * moment the backfilled pipeline is activated.
 *
 * Deliberately does NOT activate the synthesized pipeline (`RouterConfigs.
 * activePipelineVersionId` stays untouched) — publishing a v1.0 next to the tenant's still-
 * governing flat config is a safe, inert artifact; activating it is a separate, explicit,
 * audited act an admin takes from `/orchestrator/pipelines`, never something this script
 * decides on a tenant's behalf.
 *
 * Run with: `npx tsx scripts/backfill-pipeline-from-router-config.ts` (add `--dry-run` to
 * only report what would be created, without writing anything).
 */
import { randomUUID } from "node:crypto";
import { PrismaTenantRegistry } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-registry.js";
import { disconnectAllTenantDbs, getTenantDb } from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import { PrismaRouterConfigRepository } from "../apps/web/src/modules/orchestration/adapters/outbound/sql/prisma-router-config-repository.js";
import { PrismaPipelineRepository } from "../apps/web/src/modules/orchestration/adapters/outbound/sql/prisma-pipeline-repository.js";
import { PrismaAgentRepository } from "../apps/web/src/modules/agents/adapters/outbound/sql/prisma-agent-repository.js";
import { ListAgents } from "../apps/web/src/modules/agents/application/list-agents.js";
import { PublishPipelineVersion } from "../apps/web/src/modules/orchestration/application/publish-pipeline-version.js";
import type { PublishedAgentPort, PublishedAgentSummary } from "../apps/web/src/modules/orchestration/ports/published-agent-port.js";
import type { PipelineNodeRow } from "../apps/web/src/modules/orchestration/ports/pipeline-repository.js";

const DRY_RUN = process.argv.includes("--dry-run");
// `*ByStaffUserId` columns are plain `Char(26)` with no FK against `platform.StaffUsers`
// (confirmed against `prisma/tenant/schema.prisma`) — this is the exact same fixed,
// synthetic actor id `prisma-demo-data-seeder.ts`'s own `SYSTEM_SEED_ACTOR_ID` already
// establishes for a script attributing writes with no real signed-in staff user behind it.
const STAFF_USER_ID = `SEED${"0".repeat(21)}1`;

function runAsProvisioning<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenant(
    {
      tenant: assertValidSlugShape("sewa"),
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "provisioning",
    },
    fn,
  );
}

class ListAgentsPublishedAgentAdapter implements PublishedAgentPort {
  async listPublished(): Promise<readonly PublishedAgentSummary[]> {
    const { rows } = await new ListAgents({ agents: new PrismaAgentRepository() }).execute({
      status: "Published",
    });
    return rows.map((row) => ({ id: row.id }));
  }
}

const BACKFILLED_DESIGN_NAME = "Backfilled from router configuration";

interface TenantOutcome {
  readonly slug: string;
  readonly action:
    | "skipped-no-router-config"
    | "skipped-already-backfilled"
    | "created"
    | "would-create";
  readonly detail?: string;
}

async function synthesizeForTenant(now: Date): Promise<Omit<TenantOutcome, "slug">> {
  const routerConfigRepo = new PrismaRouterConfigRepository();
  const routerConfig = await routerConfigRepo.getSingleton();
  if (!routerConfig) {
    return { action: "skipped-no-router-config" };
  }

  // Idempotency is keyed on "has this script already run for this tenant", never on
  // `activePipelineVersionId` — that pointer is deliberately left untouched by this script
  // (see its own module doc comment), so a tenant can legitimately still have it `null`
  // after a real, already-completed backfill. Re-running the script must never create a
  // second duplicate design for the same tenant.
  const pipelinesForCheck = new PrismaPipelineRepository();
  const existingDesigns = await pipelinesForCheck.listDesigns();
  if (existingDesigns.some((d) => d.name === BACKFILLED_DESIGN_NAME)) {
    return { action: "skipped-already-backfilled" };
  }

  const agentsResult = await new ListAgents({ agents: new PrismaAgentRepository() }).execute({
    status: "Published",
  });
  const publishedAgents = agentsResult.rows;
  const publishedById = new Map(publishedAgents.map((a) => [a.id, a] as const));

  const maxSecondary =
    routerConfig.executionMode === "Sequential"
      ? 0
      : routerConfig.executionMode === "Parallel"
        ? 1
        : 2; // SupervisorWorker

  let secondaryAgentIds: string[] = [];
  if (maxSecondary > 0) {
    if (routerConfig.agentSelectionScope === "ExplicitList" && routerConfig.agentScopeListJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(routerConfig.agentScopeListJson);
      } catch {
        parsed = [];
      }
      const ids = Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
      secondaryAgentIds = ids.filter((id) => publishedById.has(id)).slice(0, maxSecondary);
    } else {
      // `AllPublished`/`ChannelBound` — deterministic top-N by slug, the disclosed
      // behaviour change this script's own module doc comment names.
      secondaryAgentIds = [...publishedAgents]
        .sort((a, b) => a.slug.localeCompare(b.slug))
        .slice(0, maxSecondary)
        .map((a) => a.id);
    }
  }

  if (DRY_RUN) {
    return {
      action: "would-create",
      detail: `mode=${routerConfig.executionMode} secondaries=[${secondaryAgentIds.join(", ")}]`,
    };
  }

  const pipelines = new PrismaPipelineRepository();
  const ownerTenantId = await resolveOwnerTenantId();
  const { pipelineDesignId, pipelineVersionId } = await pipelines.createPipeline({
    name: BACKFILLED_DESIGN_NAME,
    ownerTenantId,
    createdByStaffUserId: STAFF_USER_ID,
    now,
  });

  await pipelines.updateVersionSettings({
    pipelineVersionId,
    maxTotalHops: routerConfig.maxHops,
    costCeilingTokens: routerConfig.costCeilingTokens,
    costCeilingMicroAed: routerConfig.costCeilingMicroAed,
    defaultMergePolicy: routerConfig.responseMergePolicy,
    defaultConflictResolution: routerConfig.conflictResolution,
    routingStrategy: routerConfig.routingStrategy,
    minRoutingConfidence: routerConfig.minRoutingConfidence,
    fallbackAgentId: routerConfig.fallbackAgentId,
    now,
  });

  const canvas = await pipelines.getCanvas(pipelineVersionId);
  if (!canvas) throw new Error(`Freshly created pipeline version "${pipelineVersionId}" has no canvas.`);
  const startNode = canvas.nodes.find((n) => n.kind === "Start");
  if (!startNode) throw new Error(`Freshly created pipeline version "${pipelineVersionId}" has no Start node.`);

  // Every node created below gets its own, real, non-overlapping canvas position — a
  // real, not cosmetic, requirement: `@xyflow/react`'s `fitView` computes its zoom/pan
  // from the nodes' bounding box, and every node sharing one hardcoded position (e.g.
  // every node at `(0, 0)`) collapses that box to zero width/height, rendering the whole
  // canvas as visually empty even though the underlying data is real. `Start` itself
  // already sits at `(0, 0)` (`PipelineRepository.createPipeline`'s own default), so this
  // counter starts one column to its right.
  let nextColumn = 1;
  const COLUMN_WIDTH = 240;
  const ROW_HEIGHT = 160;
  function nextPosition(row = 0): { readonly canvasX: number; readonly canvasY: number } {
    const position = { canvasX: nextColumn * COLUMN_WIDTH, canvasY: row * ROW_HEIGHT };
    nextColumn += 1;
    return position;
  }

  async function addAgentNode(title: string, agentId: string | null, isOwningEntity: boolean, isTurnBound: boolean, row = 0): Promise<PipelineNodeRow> {
    return pipelines.createNode({
      pipelineVersionId,
      kind: "Agent",
      title,
      ...nextPosition(row),
      agentId,
      usesTurnBoundAgent: isTurnBound,
      agentVersionPinId: null,
      inputContextMode: "UserTurnOnly",
      isOwningEntity,
      onErrorPolicy: "FailTurn",
      now,
    });
  }

  async function addResponseNode(): Promise<PipelineNodeRow> {
    // Created AFTER every agent/worker node above has already claimed its own column, so
    // this always lands one column to the right of the widest branch — never
    // pre-guessed before the mode-specific node count is actually known.
    return pipelines.createNode({
      pipelineVersionId,
      kind: "Response",
      title: "Response",
      ...nextPosition(0),
      agentId: null,
      usesTurnBoundAgent: false,
      agentVersionPinId: null,
      inputContextMode: "UserTurnOnly",
      isOwningEntity: true,
      onErrorPolicy: "FailTurn",
      now,
    });
  }

  let ordinal = 0;
  async function wire(fromId: string, toId: string, kind: "Sequential" | "Parallel") {
    const result = await pipelines.createEdge({
      pipelineVersionId,
      fromNodeId: fromId,
      toNodeId: toId,
      kind,
      ordinal: kind === "Parallel" ? ordinal++ : 0,
      label: null,
      maxIterations: null,
      conditionExpression: null,
      now,
    });
    if (!result.ok) {
      throw new Error(`Failed to wire ${fromId} -> ${toId}: ${result.reason}`);
    }
  }

  // `TR_PipelineEdges_homogeneousFanOut` requires a real fan-out (>= 2 all-`Parallel`
  // edges) — a lone `Parallel` edge is not a legal shape. A tenant configured for
  // `Parallel` but with no real secondary agent to pin (no other Published agent exists)
  // downgrades to the `Sequential` shape instead of producing an unpublishable graph.
  const effectiveModeIsParallel = routerConfig.executionMode === "Parallel" && secondaryAgentIds[0] !== undefined;

  if (routerConfig.executionMode === "Sequential" || (routerConfig.executionMode === "Parallel" && !effectiveModeIsParallel)) {
    const primary = await addAgentNode("Primary agent (turn-bound)", null, true, true);
    const responseNode = await addResponseNode();
    await wire(startNode.id, primary.id, "Sequential");
    await wire(primary.id, responseNode.id, "Sequential");
  } else if (effectiveModeIsParallel) {
    const primary = await addAgentNode("Primary agent (turn-bound)", null, true, true, 0);
    const secondaryAgent = publishedById.get(secondaryAgentIds[0]!);
    const secondary = await addAgentNode(secondaryAgent?.name ?? secondaryAgentIds[0]!, secondaryAgentIds[0]!, false, false, 1);
    const responseNode = await addResponseNode();
    ordinal = 0;
    await wire(startNode.id, primary.id, "Parallel");
    await wire(startNode.id, secondary.id, "Parallel");
    await wire(secondary.id, responseNode.id, "Sequential");
    await wire(primary.id, responseNode.id, "Sequential");
  } else {
    // SupervisorWorker — workers chained sequentially, matching today's real execution.
    let previousId = startNode.id;
    for (const workerId of secondaryAgentIds) {
      const workerAgent = publishedById.get(workerId);
      const worker = await addAgentNode(workerAgent?.name ?? workerId, workerId, false, false);
      await wire(previousId, worker.id, "Sequential");
      previousId = worker.id;
    }
    const supervisor = await addAgentNode("Supervisor (turn-bound)", null, true, true);
    await pipelines.updateNode({
      id: supervisor.id,
      pipelineVersionId,
      inputContextMode: "UpstreamRepliesSummary",
      now,
    });
    const responseNode = await addResponseNode();
    await wire(previousId, supervisor.id, "Sequential");
    await wire(supervisor.id, responseNode.id, "Sequential");
  }

  const publishResult = await new PublishPipelineVersion({
    pipelines,
    agents: new ListAgentsPublishedAgentAdapter(),
  }).execute({ pipelineVersionId, changeSummary: "Backfilled from router configuration.", actorStaffUserId: STAFF_USER_ID, now });

  if (!publishResult.ok) {
    const findingSummary =
      publishResult.reason === "orchestration.pipeline.graph_invalid"
        ? publishResult.findings.map((f) => f.reason).join("; ")
        : publishResult.reason;
    throw new Error(`Backfilled pipeline for design "${pipelineDesignId}" failed to publish: ${findingSummary}`);
  }

  return {
    action: "created",
    detail: `pipelineDesignId=${pipelineDesignId} label=${publishResult.label}`,
  };
}

async function resolveOwnerTenantId(): Promise<string> {
  const profile = await getTenantDb("backfill-pipeline.resolveOwnerTenantId").tenantProfile.findUniqueOrThrow(
    { where: { singletonKey: 1 } },
  );
  return profile.tenantId;
}

async function main(): Promise<void> {
  const registry = new PrismaTenantRegistry();
  const tenants = await runAsProvisioning(() => registry.listActive());

  if (tenants.length === 0) {
    console.info("[backfill-pipeline-from-router-config] no Active tenants found — nothing to do.");
    return;
  }

  const now = new Date();
  const outcomes: TenantOutcome[] = [];

  for (const tenant of tenants) {
    await runWithTenant(
      {
        tenant: assertValidSlugShape(tenant.slug),
        principal: null,
        traceId: randomUUID().replace(/-/g, ""),
      },
      async () => {
        const outcome = await synthesizeForTenant(now);
        outcomes.push({ ...outcome, slug: tenant.slug });
      },
    );
  }

  console.info(
    `[backfill-pipeline-from-router-config] ${DRY_RUN ? "dry run" : "run"} across ${tenants.length} tenant(s):`,
  );
  for (const outcome of outcomes) {
    console.info(`  ${outcome.slug}: ${outcome.action}${outcome.detail ? ` (${outcome.detail})` : ""}`);
  }
  if (outcomes.some((o) => o.action === "created")) {
    console.info(
      "\nNote: any tenant whose RouterConfigs.agentSelectionScope was AllPublished/ChannelBound had its " +
        "secondary/worker agent(s) pinned to a deterministic top-N by slug — a real, disclosed behaviour " +
        "change from today's per-turn keyword-score selection. Review the synthesized graph for each such " +
        "tenant by hand before activating it.",
    );
  }
}

main()
  .then(async () => {
    await disconnectAllTenantDbs();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error("[backfill-pipeline-from-router-config] failed:", error);
    await disconnectAllTenantDbs().catch(() => {});
    process.exit(1);
  });
