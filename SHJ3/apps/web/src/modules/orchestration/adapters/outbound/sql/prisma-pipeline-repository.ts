/**
 * The real `PipelineRepository` — `PipelineDesigns`/`PipelineVersions`/`PipelineNodes`/
 * `PipelineEdges`/`PipelineVersionHistoryEntries`, per-tenant.
 *
 * Mirrors `PrismaFlowRepository`'s established shapes directly: `createPipeline`'s
 * `PipelineDesign.currentVersionId <-> PipelineVersion.pipelineDesignId` cycle is broken the
 * same way `createFlow` breaks the identical `Flow.currentVersionId <-> FlowVersion.flowId`
 * cycle (create the child with the parent unset, then update the parent once the child
 * exists — SQL Server checks FKs immediately, not deferred). `forkOrReuseDraftVersion`
 * derives the next version number from this design's true historical maximum, never from
 * `currentVersionId` alone, for the exact reason `tasks/lessons.md` records (a reversible
 * "which version is current" pointer can legitimately be older than the entity's real
 * high-water mark after a rollback).
 *
 * Simpler than the flow-side fork in one respect: a `PipelineNode` has no analogue of
 * `FlowNode.onFailureNodeId` (a node referencing another node forward), so copying a
 * version's nodes needs no topological ordering — every node can be inserted in any order,
 * with only the version's own `entryNodeId` (nullable, backfilled after) and the edges
 * (inserted last, once every node id is known) needing the id remap.
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import type {
  InputContextMode,
  NodeErrorPolicy,
  PipelineEdgeKind,
  PipelineNodeKind,
  PipelineVersionStatus,
} from "../../../domain/pipeline-vocabulary.js";
import {
  INITIAL_PIPELINE_DRAFT_VERSION,
  nextPipelineDraftVersion,
  pipelineVersionLabel,
  publishedPipelineVersionNumber,
} from "../../../domain/pipeline-version.js";
import type {
  NewPipelineEdgeInput,
  NewPipelineNodeInput,
  PipelineCanvas,
  PipelineDesignRow,
  PipelineEdgeRow,
  PipelineEdgeWriteResult,
  PipelineNodeRow,
  PipelineRepository,
  PipelineVersionHistoryEntryRow,
  PipelineVersionRow,
  PublishPipelineVersionResult,
  UpdatePipelineEdgeInput,
  UpdatePipelineNodeInput,
} from "../../../ports/pipeline-repository.js";

const OPERATION = "orchestration pipeline repository";

/** `TR_PipelineEdges_sameVersion`'s THROW text (`001_constraints.sql`), matched by
 *  substring — the same already-proven pattern `PrismaFlowRepository`'s own
 *  `WRONG_VERSION_FRAGMENT` uses. */
const WRONG_VERSION_FRAGMENT = "must belong to the same pipeline version";
/** `TR_PipelineEdges_homogeneousFanOut`'s THROW text. */
const NON_HOMOGENEOUS_FAN_OUT_FRAGMENT = "exactly one Sequential, or two or more all-Parallel";

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "pipeline"
  );
}

/** Disambiguated against existing **live** slugs (`UQ_PipelineDesigns_slug ... WHERE
 *  deletedAt IS NULL`), mirroring `PrismaFlowRepository.uniqueFlowSlug`'s exact precedent. */
async function uniquePipelineSlug(
  db: ReturnType<typeof getTenantDb>,
  name: string,
): Promise<string> {
  const base = slugify(name);
  const existing = await db.pipelineDesign.findMany({
    where: { deletedAt: null },
    select: { slug: true },
  });
  const taken = new Set(existing.map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function slugifyKey(title: string): string {
  return (
    title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "") || "node"
  );
}

/** Disambiguated against this version's existing node keys (`UQ_PipelineNodes_
 *  pipelineVersionId_key`). */
async function uniqueNodeKey(
  db: ReturnType<typeof getTenantDb>,
  pipelineVersionId: string,
  title: string,
): Promise<string> {
  const base = slugifyKey(title);
  const existing = await db.pipelineNode.findMany({
    where: { pipelineVersionId },
    select: { key: true },
  });
  const taken = new Set(existing.map((row) => row.key));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

function isPipelineVersionStatus(value: string): value is PipelineVersionStatus {
  return value === "Draft" || value === "Published" || value === "Archived";
}
function isPipelineNodeKind(value: string): value is PipelineNodeKind {
  return value === "Start" || value === "Agent" || value === "Supervisor" || value === "Response";
}
function isPipelineEdgeKind(value: string): value is PipelineEdgeKind {
  return value === "Sequential" || value === "Parallel" || value === "LoopBack";
}
function isInputContextMode(value: string): value is InputContextMode {
  return (
    value === "UserTurnOnly" || value === "UpstreamRepliesFull" || value === "UpstreamRepliesSummary"
  );
}
function isNodeErrorPolicy(value: string): value is NodeErrorPolicy {
  return value === "FailTurn" || value === "SkipNode" || value === "RouteToFallbackAgent";
}

interface PipelineDesignDbRow {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: string;
  currentVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toDesignRow(row: PipelineDesignDbRow): PipelineDesignRow {
  if (!isPipelineVersionStatus(row.status)) {
    throw new Error(`PipelineDesign ${row.id} has an unrecognized status "${row.status}".`);
  }
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    status: row.status,
    currentVersionId: row.currentVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface PipelineVersionDbRow {
  id: string;
  pipelineDesignId: string;
  major: number;
  minor: number;
  status: string;
  isCurrent: boolean;
  entryNodeId: string | null;
  maxTotalHops: number;
  costCeilingTokens: number;
  costCeilingMicroAed: bigint;
  defaultMergePolicy: string;
  defaultConflictResolution: string;
  routingStrategy: string;
  minRoutingConfidence: unknown; // Prisma Decimal
  fallbackAgentId: string | null;
  changeSummary: string | null;
  publishedAt: Date | null;
  clonedFromVersionId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toVersionRow(row: PipelineVersionDbRow): PipelineVersionRow {
  if (!isPipelineVersionStatus(row.status)) {
    throw new Error(`PipelineVersion ${row.id} has an unrecognized status "${row.status}".`);
  }
  return {
    id: row.id,
    pipelineDesignId: row.pipelineDesignId,
    major: row.major,
    minor: row.minor,
    status: row.status,
    isCurrent: row.isCurrent,
    entryNodeId: row.entryNodeId,
    maxTotalHops: row.maxTotalHops,
    costCeilingTokens: row.costCeilingTokens,
    costCeilingMicroAed: Number(row.costCeilingMicroAed),
    defaultMergePolicy: row.defaultMergePolicy,
    defaultConflictResolution: row.defaultConflictResolution,
    routingStrategy: row.routingStrategy,
    minRoutingConfidence: Number(row.minRoutingConfidence),
    fallbackAgentId: row.fallbackAgentId,
    changeSummary: row.changeSummary,
    publishedAt: row.publishedAt,
    clonedFromVersionId: row.clonedFromVersionId,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface PipelineNodeDbRow {
  id: string;
  pipelineVersionId: string;
  key: string;
  kind: string;
  title: string;
  canvasX: number;
  canvasY: number;
  agentId: string | null;
  usesTurnBoundAgent: boolean;
  agentVersionPinId: string | null;
  inputContextMode: string;
  mergePolicyOverride: string | null;
  conflictResolutionOverride: string | null;
  isOwningEntity: boolean;
  costCeilingTokensOverride: number | null;
  costCeilingMicroAedOverride: bigint | null;
  timeoutMsOverride: number | null;
  onErrorPolicy: string;
}

function toNodeRow(row: PipelineNodeDbRow): PipelineNodeRow {
  if (!isPipelineNodeKind(row.kind)) {
    throw new Error(`PipelineNode ${row.id} has an unrecognized kind "${row.kind}".`);
  }
  if (!isInputContextMode(row.inputContextMode)) {
    throw new Error(
      `PipelineNode ${row.id} has an unrecognized inputContextMode "${row.inputContextMode}".`,
    );
  }
  if (!isNodeErrorPolicy(row.onErrorPolicy)) {
    throw new Error(
      `PipelineNode ${row.id} has an unrecognized onErrorPolicy "${row.onErrorPolicy}".`,
    );
  }
  return {
    id: row.id,
    pipelineVersionId: row.pipelineVersionId,
    key: row.key,
    kind: row.kind,
    title: row.title,
    canvasX: row.canvasX,
    canvasY: row.canvasY,
    agentId: row.agentId,
    usesTurnBoundAgent: row.usesTurnBoundAgent,
    agentVersionPinId: row.agentVersionPinId,
    inputContextMode: row.inputContextMode,
    mergePolicyOverride: row.mergePolicyOverride,
    conflictResolutionOverride: row.conflictResolutionOverride,
    isOwningEntity: row.isOwningEntity,
    costCeilingTokensOverride: row.costCeilingTokensOverride,
    costCeilingMicroAedOverride:
      row.costCeilingMicroAedOverride === null ? null : Number(row.costCeilingMicroAedOverride),
    timeoutMsOverride: row.timeoutMsOverride,
    onErrorPolicy: row.onErrorPolicy,
  };
}

interface PipelineEdgeDbRow {
  id: string;
  pipelineVersionId: string;
  fromNodeId: string;
  toNodeId: string;
  kind: string;
  ordinal: number;
  label: string | null;
  maxIterations: number | null;
  conditionExpression: string | null;
}

function toEdgeRow(row: PipelineEdgeDbRow): PipelineEdgeRow {
  if (!isPipelineEdgeKind(row.kind)) {
    throw new Error(`PipelineEdge ${row.id} has an unrecognized kind "${row.kind}".`);
  }
  return {
    id: row.id,
    pipelineVersionId: row.pipelineVersionId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    kind: row.kind,
    ordinal: row.ordinal,
    label: row.label,
    maxIterations: row.maxIterations,
    conditionExpression: row.conditionExpression,
  };
}

export class PrismaPipelineRepository implements PipelineRepository {
  async listDesigns(): Promise<readonly PipelineDesignRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.pipelineDesign.findMany({
      where: { deletedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(toDesignRow);
  }

  async getDesign(pipelineDesignId: string): Promise<PipelineDesignRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.pipelineDesign.findFirst({
      where: { id: pipelineDesignId, deletedAt: null },
    });
    return row ? toDesignRow(row) : null;
  }

  async getPipelineVersion(pipelineVersionId: string): Promise<PipelineVersionRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.pipelineVersion.findFirst({
      where: { id: pipelineVersionId, deletedAt: null },
    });
    return row ? toVersionRow(row) : null;
  }

  async getCanvas(pipelineVersionId: string): Promise<PipelineCanvas | null> {
    const db = getTenantDb(OPERATION);
    const version = await db.pipelineVersion.findFirst({
      where: { id: pipelineVersionId, deletedAt: null },
    });
    if (!version) return null;
    const [nodes, edges] = await Promise.all([
      db.pipelineNode.findMany({ where: { pipelineVersionId }, orderBy: { createdAt: "asc" } }),
      db.pipelineEdge.findMany({ where: { pipelineVersionId }, orderBy: { ordinal: "asc" } }),
    ]);
    return {
      version: toVersionRow(version),
      nodes: nodes.map(toNodeRow),
      edges: edges.map(toEdgeRow),
    };
  }

  async listVersionHistory(
    pipelineDesignId: string,
  ): Promise<readonly PipelineVersionHistoryEntryRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.pipelineVersionHistoryEntry.findMany({
      where: { pipelineDesignId },
      orderBy: { occurredAt: "desc" },
    });
    return rows.map((row) => ({
      id: row.id,
      pipelineVersionId: row.pipelineVersionId,
      kind: row.kind,
      note: row.note,
      fromVersionId: row.fromVersionId,
      actorStaffUserId: row.actorStaffUserId,
      occurredAt: row.occurredAt,
    }));
  }

  async createPipeline(input: {
    readonly name: string;
    readonly ownerTenantId: string;
    readonly createdByStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly pipelineDesignId: string; readonly pipelineVersionId: string }> {
    const db = getTenantDb(OPERATION);
    const { now } = input;
    const slug = await uniquePipelineSlug(db, input.name);
    const designId = newUlid(now);
    const versionId = newUlid(new Date(now.getTime() + 1));
    const startNodeId = newUlid(new Date(now.getTime() + 2));

    // `PipelineDesign.currentVersionId <-> PipelineVersion.pipelineDesignId` form a cycle
    // neither direction can satisfy on first insert (SQL Server checks FKs immediately) —
    // created with `currentVersionId`/`entryNodeId` null first, then updated once the
    // dependent rows exist, matching `PrismaFlowRepository.createFlow`'s identical
    // precedent. A brand-new version is never entirely empty: `UQ_PipelineNodes_start`
    // requires exactly one `Start` node per version, so this transaction creates it too.
    await db.$transaction([
      db.pipelineDesign.create({
        data: {
          id: designId,
          name: input.name,
          slug,
          description: null,
          ownerTenantId: input.ownerTenantId,
          status: "Draft",
          currentVersionId: null,
          createdByStaffUserId: input.createdByStaffUserId,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.pipelineVersion.create({
        data: {
          id: versionId,
          pipelineDesignId: designId,
          major: INITIAL_PIPELINE_DRAFT_VERSION.major,
          minor: INITIAL_PIPELINE_DRAFT_VERSION.minor,
          status: "Draft",
          isCurrent: true,
          entryNodeId: null,
          maxTotalHops: 10,
          costCeilingTokens: 8000,
          costCeilingMicroAed: 350_000n,
          defaultMergePolicy: "DeduplicateOverlap",
          defaultConflictResolution: "HighestConfidence",
          routingStrategy: "IntentClassifier",
          minRoutingConfidence: 0.3,
          fallbackAgentId: null,
          changeSummary: null,
          createdByStaffUserId: input.createdByStaffUserId,
          publishedAt: null,
          clonedFromVersionId: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.pipelineNode.create({
        data: {
          id: startNodeId,
          pipelineVersionId: versionId,
          key: "start",
          kind: "Start",
          title: "Start",
          canvasX: 0,
          canvasY: 0,
          agentId: null,
          usesTurnBoundAgent: false,
          agentVersionPinId: null,
          inputContextMode: "UserTurnOnly",
          mergePolicyOverride: null,
          conflictResolutionOverride: null,
          isOwningEntity: false,
          costCeilingTokensOverride: null,
          costCeilingMicroAedOverride: null,
          timeoutMsOverride: null,
          onErrorPolicy: "FailTurn",
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.pipelineDesign.update({
        where: { id: designId },
        data: { currentVersionId: versionId, updatedAt: now },
      }),
      db.pipelineVersion.update({
        where: { id: versionId },
        data: { entryNodeId: startNodeId, updatedAt: now },
      }),
      db.pipelineVersionHistoryEntry.create({
        data: {
          id: newUlid(new Date(now.getTime() + 3)),
          pipelineDesignId: designId,
          pipelineVersionId: versionId,
          kind: "Created",
          note: `Created ${input.name}.`,
          fromVersionId: null,
          actorStaffUserId: input.createdByStaffUserId,
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);

    return { pipelineDesignId: designId, pipelineVersionId: versionId };
  }

  async forkOrReuseDraftVersion(input: {
    readonly pipelineDesignId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly pipelineVersionId: string }> {
    const db = getTenantDb(OPERATION);
    const design = await db.pipelineDesign.findFirstOrThrow({
      where: { id: input.pipelineDesignId, deletedAt: null },
    });
    if (!design.currentVersionId) {
      throw new Error(`PipelineDesign ${design.id} has no current version — cannot open it for authoring.`);
    }
    const current = await db.pipelineVersion.findFirstOrThrow({
      where: { id: design.currentVersionId },
    });

    if (current.status !== "Published") {
      // Already a Draft (or an Archived version left current by some other path) — nothing
      // to fork, authoring continues directly against it.
      return { pipelineVersionId: current.id };
    }

    // A REAL bug this exact check caught live (a genuine duplicate-draft-per-page-load,
    // reproduced against the real dev database): `PipelineDesign.currentVersionId` is
    // deliberately left pointing at the Published version after a fork (`isCurrent`/
    // `currentVersionId` only move once THIS draft itself publishes — see the comment on
    // the new version's own `isCurrent: false` below) — so re-running this method with no
    // other signal ALWAYS re-derives `current.status === "Published"` and forks ANOTHER
    // new draft, every single time the editor page loads. Unlike the agent wizard's
    // equivalent (`GetOrCreateWizardDraft`), which avoids this via its own separate,
    // owner-scoped `WizardDraft` tracking row, a pipeline has no such per-owner draft
    // concept (this design's own single shared editing surface) — so the fix here is
    // simpler: look for an ALREADY-FORKED Draft version of this exact design directly,
    // regardless of what `currentVersionId` still points at, and reuse it if one exists.
    const existingDraft = await db.pipelineVersion.findFirst({
      where: { pipelineDesignId: design.id, status: "Draft" },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
    });
    if (existingDraft) {
      return { pipelineVersionId: existingDraft.id };
    }

    // The next version number must be strictly newer than every version this design has
    // ever had, not just `current` alone — see this file's own module comment
    // (`tasks/lessons.md`'s recorded lesson).
    const highestVersion = await db.pipelineVersion.findFirstOrThrow({
      where: { pipelineDesignId: design.id },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
    });
    const draftVersion = nextPipelineDraftVersion({
      major: highestVersion.major,
      minor: highestVersion.minor,
    });

    // Deep-copies the Published source's real canvas (nodes, then edges) into the new
    // Draft — mirroring `PrismaFlowRepository.forkOrReuseDraftVersion`'s own precedent. No
    // topological ordering is needed for the nodes themselves (unlike `FlowNode.
    // onFailureNodeId`, a `PipelineNode` never references another node) — only the
    // version's own `entryNodeId` needs the id remap, backfilled once the copied nodes
    // exist.
    const [sourceNodes, sourceEdges] = await Promise.all([
      db.pipelineNode.findMany({ where: { pipelineVersionId: current.id } }),
      db.pipelineEdge.findMany({ where: { pipelineVersionId: current.id } }),
    ]);

    let tick = 0;
    const stamp = () => new Date(input.now.getTime() + tick++);
    const newVersionId = newUlid(stamp());
    const nodeIdMap = new Map(sourceNodes.map((node) => [node.id, newUlid(stamp())]));

    await db.$transaction([
      db.pipelineVersion.create({
        data: {
          id: newVersionId,
          pipelineDesignId: design.id,
          major: draftVersion.major,
          minor: draftVersion.minor,
          // Not current yet — the Published version stays current (and stays what
          // `ExecutePipeline` runs, if active) until this draft is itself published.
          // Matches `PrismaFlowRepository.forkOrReuseDraftVersion`'s identical reasoning.
          status: "Draft",
          isCurrent: false,
          // Backfilled below, once the copied nodes exist.
          entryNodeId: null,
          maxTotalHops: current.maxTotalHops,
          costCeilingTokens: current.costCeilingTokens,
          costCeilingMicroAed: current.costCeilingMicroAed,
          defaultMergePolicy: current.defaultMergePolicy,
          defaultConflictResolution: current.defaultConflictResolution,
          routingStrategy: current.routingStrategy,
          minRoutingConfidence: current.minRoutingConfidence,
          fallbackAgentId: current.fallbackAgentId,
          changeSummary: null,
          createdByStaffUserId: input.actorStaffUserId,
          publishedAt: null,
          clonedFromVersionId: current.id,
          deletedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        },
      }),
      ...sourceNodes.map((node) =>
        db.pipelineNode.create({
          data: {
            id: nodeIdMap.get(node.id)!,
            pipelineVersionId: newVersionId,
            key: node.key,
            kind: node.kind,
            title: node.title,
            canvasX: node.canvasX,
            canvasY: node.canvasY,
            // The real, shared `Agent`/`AgentVersion` this node calls — copied verbatim,
            // never remapped: agents belong to the agent registry, not to any one
            // pipeline version.
            agentId: node.agentId,
            usesTurnBoundAgent: node.usesTurnBoundAgent,
            agentVersionPinId: node.agentVersionPinId,
            inputContextMode: node.inputContextMode,
            mergePolicyOverride: node.mergePolicyOverride,
            conflictResolutionOverride: node.conflictResolutionOverride,
            isOwningEntity: node.isOwningEntity,
            costCeilingTokensOverride: node.costCeilingTokensOverride,
            costCeilingMicroAedOverride: node.costCeilingMicroAedOverride,
            timeoutMsOverride: node.timeoutMsOverride,
            onErrorPolicy: node.onErrorPolicy,
            createdAt: input.now,
            updatedAt: input.now,
          },
        }),
      ),
      ...sourceEdges.map((edge) =>
        db.pipelineEdge.create({
          data: {
            id: newUlid(stamp()),
            pipelineVersionId: newVersionId,
            // Both endpoints are guaranteed present in `nodeIdMap`: `TR_PipelineEdges_
            // sameVersion` already forbids a real edge from referencing a node outside
            // its own version.
            fromNodeId: nodeIdMap.get(edge.fromNodeId)!,
            toNodeId: nodeIdMap.get(edge.toNodeId)!,
            kind: edge.kind,
            ordinal: edge.ordinal,
            label: edge.label,
            maxIterations: edge.maxIterations,
            conditionExpression: edge.conditionExpression,
            createdAt: input.now,
            updatedAt: input.now,
          },
        }),
      ),
      ...(current.entryNodeId !== null
        ? [
            db.pipelineVersion.update({
              where: { id: newVersionId },
              data: { entryNodeId: nodeIdMap.get(current.entryNodeId) ?? null },
            }),
          ]
        : []),
      db.pipelineVersionHistoryEntry.create({
        data: {
          id: newUlid(stamp()),
          pipelineDesignId: design.id,
          pipelineVersionId: newVersionId,
          kind: "Cloned",
          note: `Cloned from v${current.major}.${current.minor}.`,
          fromVersionId: current.id,
          actorStaffUserId: input.actorStaffUserId,
          occurredAt: input.now,
          createdAt: input.now,
          updatedAt: input.now,
        },
      }),
    ]);

    return { pipelineVersionId: newVersionId };
  }

  async publishVersion(input: {
    readonly pipelineVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<PublishPipelineVersionResult> {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    const version = await db.pipelineVersion.findFirstOrThrow({
      where: { id: input.pipelineVersionId },
    });
    if (version.status === "Published") {
      return { ok: false, reason: "orchestration.pipeline.already_published" };
    }

    const publishedNumber = publishedPipelineVersionNumber({
      major: version.major,
      minor: version.minor,
    });
    const label = pipelineVersionLabel(publishedNumber);

    // Un-current whichever version was current before, if it differs — MUST be ordered
    // before this version's own `isCurrent` flips to true, mirroring `PrismaFlowRepository.
    // publishVersion`'s identical note on `UQ_*_current WHERE isCurrent = 1` being checked
    // per-statement, not deferred to commit.
    const previousCurrent = await db.pipelineVersion.findFirst({
      where: {
        pipelineDesignId: version.pipelineDesignId,
        isCurrent: true,
        id: { not: version.id },
      },
    });

    try {
      await db.$transaction([
        ...(previousCurrent
          ? [
              db.pipelineVersion.update({
                where: { id: previousCurrent.id },
                data: { isCurrent: false, updatedAt: now },
              }),
            ]
          : []),
        db.pipelineVersion.update({
          where: { id: version.id },
          data: {
            major: publishedNumber.major,
            minor: publishedNumber.minor,
            status: "Published",
            isCurrent: true,
            publishedAt: now,
            publishedByStaffUserId: actorStaffUserId,
            changeSummary: input.changeSummary,
            updatedAt: now,
          },
        }),
        db.pipelineDesign.update({
          where: { id: version.pipelineDesignId },
          data: { status: "Published", currentVersionId: version.id, updatedAt: now },
        }),
        db.pipelineVersionHistoryEntry.create({
          data: {
            id: newUlid(now),
            pipelineDesignId: version.pipelineDesignId,
            pipelineVersionId: version.id,
            kind: "Published",
            note: `Published ${label}.`,
            fromVersionId: null,
            actorStaffUserId,
            occurredAt: now,
            createdAt: now,
            updatedAt: now,
          },
        }),
      ]);
    } catch (error) {
      // `TR_PipelineVersions_publishGraphValid` is the real, final backstop — the primary
      // gate is the caller's own `analyzePipelineGraph`/`POST /pipelines/validate` check,
      // run before this method is ever called. Reaching this catch means either that check
      // was skipped, or (rarely) the graph changed between the check and this call.
      if (error instanceof Error && error.message.includes("publish")) {
        return { ok: false, reason: "orchestration.pipeline.graph_invalid" };
      }
      throw error;
    }

    return { ok: true, label };
  }

  async rollbackToVersion(input: {
    readonly pipelineDesignId: string;
    readonly targetVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<
    | { readonly ok: true }
    | { readonly ok: false; readonly reason: "orchestration.pipeline.version_is_current" }
  > {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    const target = await db.pipelineVersion.findFirstOrThrow({
      where: { id: input.targetVersionId },
    });
    if (target.pipelineDesignId !== input.pipelineDesignId) {
      throw new Error(
        `rollbackToVersion: version ${target.id} belongs to design ${target.pipelineDesignId}, not ${input.pipelineDesignId} — refusing rather than silently operating on the wrong design's current-version state.`,
      );
    }
    if (target.isCurrent) {
      return { ok: false, reason: "orchestration.pipeline.version_is_current" };
    }

    const label = pipelineVersionLabel({ major: target.major, minor: target.minor });
    await db.$transaction([
      db.pipelineVersion.updateMany({
        where: { pipelineDesignId: target.pipelineDesignId, isCurrent: true },
        data: { isCurrent: false, updatedAt: now },
      }),
      db.pipelineVersion.update({
        where: { id: target.id },
        data: { isCurrent: true, updatedAt: now },
      }),
      db.pipelineDesign.update({
        where: { id: target.pipelineDesignId },
        data: { currentVersionId: target.id, updatedAt: now },
      }),
      db.pipelineVersionHistoryEntry.create({
        data: {
          id: newUlid(now),
          pipelineDesignId: target.pipelineDesignId,
          pipelineVersionId: target.id,
          kind: "RolledBack",
          note: `Rolled back to ${label}.`,
          fromVersionId: target.id,
          actorStaffUserId,
          occurredAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);
    return { ok: true };
  }

  async updateVersionSettings(input: {
    readonly pipelineVersionId: string;
    readonly maxTotalHops: number;
    readonly costCeilingTokens: number;
    readonly costCeilingMicroAed: number;
    readonly defaultMergePolicy: string;
    readonly defaultConflictResolution: string;
    readonly routingStrategy: string;
    readonly minRoutingConfidence: number;
    readonly fallbackAgentId: string | null;
    readonly now: Date;
  }): Promise<PipelineVersionRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.pipelineVersion.update({
      where: { id: input.pipelineVersionId },
      data: {
        maxTotalHops: input.maxTotalHops,
        costCeilingTokens: input.costCeilingTokens,
        costCeilingMicroAed: BigInt(input.costCeilingMicroAed),
        defaultMergePolicy: input.defaultMergePolicy,
        defaultConflictResolution: input.defaultConflictResolution,
        routingStrategy: input.routingStrategy,
        minRoutingConfidence: input.minRoutingConfidence,
        fallbackAgentId: input.fallbackAgentId,
        updatedAt: input.now,
      },
    });
    return toVersionRow(row);
  }

  async createNode(input: NewPipelineNodeInput): Promise<PipelineNodeRow> {
    const db = getTenantDb(OPERATION);
    const key = await uniqueNodeKey(db, input.pipelineVersionId, input.title);
    const row = await db.pipelineNode.create({
      data: {
        id: newUlid(input.now),
        pipelineVersionId: input.pipelineVersionId,
        key,
        kind: input.kind,
        title: input.title,
        canvasX: input.canvasX,
        canvasY: input.canvasY,
        agentId: input.agentId,
        usesTurnBoundAgent: input.usesTurnBoundAgent,
        agentVersionPinId: input.agentVersionPinId,
        inputContextMode: input.inputContextMode,
        mergePolicyOverride: null,
        conflictResolutionOverride: null,
        isOwningEntity: input.isOwningEntity,
        costCeilingTokensOverride: null,
        costCeilingMicroAedOverride: null,
        timeoutMsOverride: null,
        onErrorPolicy: input.onErrorPolicy,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toNodeRow(row);
  }

  async updateNode(input: UpdatePipelineNodeInput): Promise<PipelineNodeRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.pipelineNode.update({
      where: { id: input.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.canvasX !== undefined ? { canvasX: input.canvasX } : {}),
        ...(input.canvasY !== undefined ? { canvasY: input.canvasY } : {}),
        ...(input.agentId !== undefined ? { agentId: input.agentId } : {}),
        ...(input.usesTurnBoundAgent !== undefined
          ? { usesTurnBoundAgent: input.usesTurnBoundAgent }
          : {}),
        ...(input.agentVersionPinId !== undefined
          ? { agentVersionPinId: input.agentVersionPinId }
          : {}),
        ...(input.inputContextMode !== undefined
          ? { inputContextMode: input.inputContextMode }
          : {}),
        ...(input.mergePolicyOverride !== undefined
          ? { mergePolicyOverride: input.mergePolicyOverride }
          : {}),
        ...(input.conflictResolutionOverride !== undefined
          ? { conflictResolutionOverride: input.conflictResolutionOverride }
          : {}),
        ...(input.isOwningEntity !== undefined ? { isOwningEntity: input.isOwningEntity } : {}),
        ...(input.costCeilingTokensOverride !== undefined
          ? { costCeilingTokensOverride: input.costCeilingTokensOverride }
          : {}),
        ...(input.costCeilingMicroAedOverride !== undefined
          ? {
              costCeilingMicroAedOverride:
                input.costCeilingMicroAedOverride === null
                  ? null
                  : BigInt(input.costCeilingMicroAedOverride),
            }
          : {}),
        ...(input.timeoutMsOverride !== undefined
          ? { timeoutMsOverride: input.timeoutMsOverride }
          : {}),
        ...(input.onErrorPolicy !== undefined ? { onErrorPolicy: input.onErrorPolicy } : {}),
        updatedAt: input.now,
      },
    });
    return toNodeRow(row);
  }

  async deleteNode(id: string, pipelineVersionId: string): Promise<void> {
    const db = getTenantDb(OPERATION);
    // Hard-delete cascades to `PipelineEdges` via `onDelete: Cascade` (the schema's own FK),
    // so no explicit edge cleanup is needed here — matching `PrismaFlowRepository.deleteNode`'s
    // own note that a real FK, not application code, is the actual cascade mechanism.
    await db.pipelineNode.deleteMany({ where: { id, pipelineVersionId } });
  }

  async createEdge(input: NewPipelineEdgeInput): Promise<PipelineEdgeWriteResult> {
    const db = getTenantDb(OPERATION);
    // Pre-check `TR_PipelineEdges_sameVersion` cheaply rather than relying only on the
    // trigger's own post-insert rollback — both endpoints must already exist in this exact
    // version.
    const [fromNode, toNode] = await Promise.all([
      db.pipelineNode.findFirst({
        where: { id: input.fromNodeId, pipelineVersionId: input.pipelineVersionId },
      }),
      db.pipelineNode.findFirst({
        where: { id: input.toNodeId, pipelineVersionId: input.pipelineVersionId },
      }),
    ]);
    if (!fromNode || !toNode) {
      return { ok: false, reason: "orchestration.pipeline.endpoint_wrong_version" };
    }

    try {
      const row = await db.pipelineEdge.create({
        data: {
          id: newUlid(input.now),
          pipelineVersionId: input.pipelineVersionId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          kind: input.kind,
          ordinal: input.ordinal,
          label: input.label,
          maxIterations: input.maxIterations,
          conditionExpression: input.conditionExpression,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { ok: true, edge: toEdgeRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(WRONG_VERSION_FRAGMENT)) {
        return { ok: false, reason: "orchestration.pipeline.endpoint_wrong_version" };
      }
      if (error instanceof Error && error.message.includes(NON_HOMOGENEOUS_FAN_OUT_FRAGMENT)) {
        return { ok: false, reason: "orchestration.pipeline.non_homogeneous_fan_out" };
      }
      throw error;
    }
  }

  async updateEdge(input: UpdatePipelineEdgeInput): Promise<PipelineEdgeWriteResult> {
    const db = getTenantDb(OPERATION);
    try {
      const row = await db.pipelineEdge.update({
        where: { id: input.id },
        data: {
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.ordinal !== undefined ? { ordinal: input.ordinal } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations } : {}),
          ...(input.conditionExpression !== undefined
            ? { conditionExpression: input.conditionExpression }
            : {}),
          updatedAt: input.now,
        },
      });
      return { ok: true, edge: toEdgeRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(NON_HOMOGENEOUS_FAN_OUT_FRAGMENT)) {
        return { ok: false, reason: "orchestration.pipeline.non_homogeneous_fan_out" };
      }
      throw error;
    }
  }

  async deleteEdge(id: string, pipelineVersionId: string): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.pipelineEdge.deleteMany({ where: { id, pipelineVersionId } });
  }

  async setEntryNode(pipelineVersionId: string, nodeId: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.pipelineVersion.update({
      where: { id: pipelineVersionId },
      data: { entryNodeId: nodeId, updatedAt: now },
    });
  }

  async recordVersionActivation(input: {
    readonly pipelineVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<void> {
    const db = getTenantDb(OPERATION);
    const version = await db.pipelineVersion.findFirstOrThrow({
      where: { id: input.pipelineVersionId },
    });
    const label = pipelineVersionLabel({ major: version.major, minor: version.minor });
    await db.pipelineVersionHistoryEntry.create({
      data: {
        id: newUlid(input.now),
        pipelineDesignId: version.pipelineDesignId,
        pipelineVersionId: version.id,
        kind: "Activated",
        note: `Activated ${label}.`,
        fromVersionId: null,
        actorStaffUserId: input.actorStaffUserId,
        occurredAt: input.now,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
  }
}
