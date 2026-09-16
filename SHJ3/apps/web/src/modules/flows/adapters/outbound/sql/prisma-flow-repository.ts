/**
 * The real `FlowRepository` — `Flows`/`FlowVersions`/`FlowNodes`/`FlowEdges`, per-tenant.
 *
 * Mirrors `PrismaAgentRepository`'s established shapes directly: `createFlow`'s
 * `Flow.currentVersionId <-> FlowVersion.flowId` cycle is broken the same way
 * `createAgent` breaks the identical `Agent.currentVersionId <-> AgentVersion.agentId`
 * cycle (create the child with the parent unset, then update the parent once the child
 * exists — SQL Server checks FKs immediately, not deferred); `forkOrReuseDraftVersion`
 * derives the next version number from this flow's true historical maximum, not from
 * `current` alone, for the exact reason `tasks/lessons.md` records for the identical bug
 * once found in `PrismaAgentRepository`'s own copy of this method (a reversible
 * "which version is current" pointer can legitimately be older than the entity's real
 * high-water mark).
 */

import { getTenantDb } from "../../../../platform/adapters/outbound/sql/tenant-db.js";
import { newUlid } from "../../../../platform/adapters/outbound/sql/ulid.js";
import {
  isFlowNodeHandoverReason,
  isFlowNodeType,
  isFlowRequiredAssuranceLevel,
  isOptionSourceKind,
} from "../../../domain/flow-node.js";
import {
  INITIAL_FLOW_DRAFT_VERSION,
  flowVersionLabel,
  nextFlowDraftVersion,
  publishedFlowVersionNumber,
} from "../../../domain/flow-version.js";
import type {
  FlowEdgeRow,
  FlowEdgeWriteResult,
  FlowNodeRow,
  FlowRepository,
  FlowVersionRow,
  NewFlowEdgeInput,
  NewFlowNodeInput,
  UpdateFlowEdgeInput,
  UpdateFlowNodeInput,
} from "../../../ports/flow-repository.js";

const OPERATION = "flows flow repository";

/** `TR_FlowEdges_sameVersion`'s THROW text (`001_constraints.sql`), matched by substring — the same already-proven pattern `PrismaToolBindingRepository`/`PrismaRoleRepository` use for a trigger Prisma does not surface as a structured error. */
const WRONG_VERSION_FRAGMENT = "must belong to the same flow version";

function slugify(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "flow"
  );
}

/** Disambiguated against existing **live** slugs (`UQ_Flows_slug ... WHERE deletedAt IS NULL`), mirroring `PrismaAgentRepository.uniqueSlug`'s exact precedent. */
async function uniqueFlowSlug(db: ReturnType<typeof getTenantDb>, name: string): Promise<string> {
  const base = slugify(name);
  const existing = await db.flow.findMany({ where: { deletedAt: null }, select: { slug: true } });
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

/** Disambiguated against this version's existing node keys (`UQ_FlowNodes_flowVersionId_key`). */
async function uniqueNodeKey(
  db: ReturnType<typeof getTenantDb>,
  flowVersionId: string,
  title: string,
): Promise<string> {
  const base = slugifyKey(title);
  const existing = await db.flowNode.findMany({ where: { flowVersionId }, select: { key: true } });
  const taken = new Set(existing.map((row) => row.key));
  if (!taken.has(base)) return base;
  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${base}_${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/**
 * Orders a flow's real nodes so that every `ToolCall` node's `onFailureNodeId` target is
 * already earlier in the list — the exact order `forkOrReuseDraftVersion` needs to insert a
 * deep copy of them one at a time and satisfy `CK_FlowNodes_toolCallFields` (`onFailureNodeId
 * IS NOT NULL` for that type, checked immediately on INSERT) without ever writing a
 * placeholder `null` first. A depth-first "visit dependencies before the node itself" order
 * (Kahn's-algorithm-equivalent, implemented via recursion since a real flow's node count is
 * small) — `visiting` detects a genuine cycle (two `ToolCall` nodes whose failure paths point
 * at each other), which no topological order can satisfy; thrown as a clear, real error
 * (`CLAUDE.md`'s "no silent catches" rule) rather than silently mis-ordering the copy, since
 * nothing in the schema itself forbids that shape even though B7's own design (`§4.8`'s "falls
 * through to the condition node") never intends it.
 */
function topoSortByFailurePath<T extends { id: string; onFailureNodeId: string | null }>(
  nodes: readonly T[],
): readonly T[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const order: T[] = [];

  function visit(node: T): void {
    if (visited.has(node.id)) return;
    if (visiting.has(node.id)) {
      throw new Error(
        `Cannot fork this flow: node "${node.id}" is part of a cycle of onFailureNodeId references, which cannot be copied in any valid insert order.`,
      );
    }
    visiting.add(node.id);
    if (node.onFailureNodeId !== null) {
      const target = byId.get(node.onFailureNodeId);
      // A target outside this node set would already violate the real, existing
      // `onFailureNode` FK on the SOURCE row — never expected, but if it somehow occurred,
      // there is simply no ordering constraint to enforce for it here.
      if (target) visit(target);
    }
    visiting.delete(node.id);
    visited.add(node.id);
    order.push(node);
  }

  for (const node of nodes) visit(node);
  return order;
}

interface FlowVersionDbRow {
  id: string;
  flowId: string;
  major: number;
  minor: number;
  status: string;
  isCurrent: boolean;
  entryNodeId: string | null;
  freeTextEscapeEnabled: boolean;
  escapeNodeId: string | null;
  changeSummary: string | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

function toVersionRow(row: FlowVersionDbRow): FlowVersionRow {
  if (row.status !== "Draft" && row.status !== "Published" && row.status !== "Archived") {
    throw new Error(`FlowVersion ${row.id} has an unrecognized status "${row.status}".`);
  }
  return {
    id: row.id,
    flowId: row.flowId,
    major: row.major,
    minor: row.minor,
    status: row.status,
    isCurrent: row.isCurrent,
    entryNodeId: row.entryNodeId,
    freeTextEscapeEnabled: row.freeTextEscapeEnabled,
    escapeNodeId: row.escapeNodeId,
    changeSummary: row.changeSummary,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface FlowNodeDbRow {
  id: string;
  flowVersionId: string;
  key: string;
  type: string;
  title: string;
  canvasX: number;
  canvasY: number;
  messageText: string | null;
  quickActionSetKey: string | null;
  slotName: string | null;
  optionSourceKind: string | null;
  optionSourceRef: string | null;
  staticOptionsJson: string | null;
  toolBindingId: string | null;
  retryCount: number | null;
  retryOnTimeout: boolean | null;
  timeoutMs: number | null;
  onFailureNodeId: string | null;
  handoverReason: string | null;
  confidenceThreshold: unknown; // Prisma Decimal | null
  conditionExpression: string | null;
  requiredAssurance: string | null;
  createdAt: Date;
  updatedAt: Date;
}

function toNodeRow(row: FlowNodeDbRow): FlowNodeRow {
  if (!isFlowNodeType(row.type)) {
    throw new Error(`FlowNode ${row.id} has an unrecognized type "${row.type}".`);
  }
  if (row.optionSourceKind !== null && !isOptionSourceKind(row.optionSourceKind)) {
    throw new Error(
      `FlowNode ${row.id} has an unrecognized optionSourceKind "${row.optionSourceKind}".`,
    );
  }
  if (row.handoverReason !== null && !isFlowNodeHandoverReason(row.handoverReason)) {
    throw new Error(
      `FlowNode ${row.id} has an unrecognized handoverReason "${row.handoverReason}".`,
    );
  }
  if (row.requiredAssurance !== null && !isFlowRequiredAssuranceLevel(row.requiredAssurance)) {
    throw new Error(
      `FlowNode ${row.id} has an unrecognized requiredAssurance "${row.requiredAssurance}".`,
    );
  }
  return {
    id: row.id,
    flowVersionId: row.flowVersionId,
    key: row.key,
    type: row.type,
    title: row.title,
    canvasX: row.canvasX,
    canvasY: row.canvasY,
    messageText: row.messageText,
    quickActionSetKey: row.quickActionSetKey,
    slotName: row.slotName,
    optionSourceKind: row.optionSourceKind,
    optionSourceRef: row.optionSourceRef,
    staticOptionsJson: row.staticOptionsJson,
    toolBindingId: row.toolBindingId,
    retryCount: row.retryCount,
    retryOnTimeout: row.retryOnTimeout,
    timeoutMs: row.timeoutMs,
    onFailureNodeId: row.onFailureNodeId,
    handoverReason: row.handoverReason,
    confidenceThreshold: row.confidenceThreshold === null ? null : Number(row.confidenceThreshold),
    conditionExpression: row.conditionExpression,
    requiredAssurance: row.requiredAssurance,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

interface FlowEdgeDbRow {
  id: string;
  flowVersionId: string;
  fromNodeId: string;
  toNodeId: string;
  label: string | null;
  ordinal: number;
  conditionExpression: string | null;
  isDefaultBranch: boolean;
  createdAt: Date;
  updatedAt: Date;
}

function toEdgeRow(row: FlowEdgeDbRow): FlowEdgeRow {
  return {
    id: row.id,
    flowVersionId: row.flowVersionId,
    fromNodeId: row.fromNodeId,
    toNodeId: row.toNodeId,
    label: row.label,
    ordinal: row.ordinal,
    conditionExpression: row.conditionExpression,
    isDefaultBranch: row.isDefaultBranch,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class PrismaFlowRepository implements FlowRepository {
  async getFlowVersion(flowVersionId: string): Promise<FlowVersionRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.flowVersion.findFirst({ where: { id: flowVersionId, deletedAt: null } });
    return row ? toVersionRow(row) : null;
  }

  async createFlow(input: {
    readonly name: string;
    readonly ownerTenantId: string;
    readonly createdByStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly flowId: string; readonly flowVersionId: string }> {
    const db = getTenantDb(OPERATION);
    const { now } = input;
    const slug = await uniqueFlowSlug(db, input.name);
    const flowId = newUlid(now);
    const versionId = newUlid(new Date(now.getTime() + 1));

    // Flow.currentVersionId <-> FlowVersion.flowId form a cycle neither direction can
    // satisfy on first insert (SQL Server checks FKs immediately) — created with
    // currentVersionId null first, then updated once the version row exists, matching
    // `PrismaAgentRepository.createAgent`'s identical precedent exactly.
    await db.$transaction([
      db.flow.create({
        data: {
          id: flowId,
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
      db.flowVersion.create({
        data: {
          id: versionId,
          flowId,
          major: INITIAL_FLOW_DRAFT_VERSION.major,
          minor: INITIAL_FLOW_DRAFT_VERSION.minor,
          status: "Draft",
          isCurrent: true,
          entryNodeId: null,
          freeTextEscapeEnabled: true,
          escapeNodeId: null,
          changeSummary: null,
          createdByStaffUserId: input.createdByStaffUserId,
          publishedAt: null,
          deletedAt: null,
          createdAt: now,
          updatedAt: now,
        },
      }),
      db.flow.update({
        where: { id: flowId },
        data: { currentVersionId: versionId, updatedAt: now },
      }),
    ]);

    return { flowId, flowVersionId: versionId };
  }

  async forkOrReuseDraftVersion(input: {
    readonly flowId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly flowVersionId: string }> {
    const db = getTenantDb(OPERATION);
    const flow = await db.flow.findFirstOrThrow({ where: { id: input.flowId, deletedAt: null } });
    if (!flow.currentVersionId) {
      throw new Error(`Flow ${flow.id} has no current version — cannot open it for authoring.`);
    }
    const current = await db.flowVersion.findFirstOrThrow({ where: { id: flow.currentVersionId } });

    if (current.status !== "Published") {
      // Already a Draft (or an Archived version left current by some other path) — nothing
      // to fork, authoring continues directly against it.
      return { flowVersionId: current.id };
    }

    // The next version number must be strictly newer than every version this flow has ever
    // had, not just `current` alone — see this file's own module comment.
    const highestVersion = await db.flowVersion.findFirstOrThrow({
      where: { flowId: flow.id },
      orderBy: [{ major: "desc" }, { minor: "desc" }],
    });
    const draftVersion = nextFlowDraftVersion({
      major: highestVersion.major,
      minor: highestVersion.minor,
    });

    // Deep-copies the Published source's real canvas (nodes, edges, entry/escape node) into
    // the new Draft — mirroring `PrismaAgentRepository.forkOrReuseDraftVersion`'s own
    // `bindingCopyOperations` precedent, which this method previously did NOT do: a real,
    // live-reproduced bug (a Playwright verification pass) found that opening an already-
    // published flow for its first round of edits landed on a completely empty canvas, since
    // nothing here ever copied the source version's real content into the fork.
    //
    // `onFailureNodeId` (`FlowNode`) is a real, immediately-checked FK that can reference a
    // node created LATER in naive insertion order — but unlike `entryNodeId`/`escapeNodeId`
    // below (nullable on `FlowVersion`, safe to null-then-backfill), it CANNOT be written as
    // `null` on first insert for a `ToolCall` node: `CK_FlowNodes_toolCallFields`
    // (`prisma/sql/001_constraints.sql`) requires `onFailureNodeId IS NOT NULL` for that type
    // at insert time, the same "checked immediately, never deferred" SQL Server behaviour this
    // file's own module comment already names for FKs — confirmed the hard way, by a live
    // verification pass that hit exactly this CHECK violation against a real ToolCall node.
    // Nodes are therefore inserted in **topological order** over the dependency
    // `onFailureNodeId` induces (a node's failure-path target must already exist before the
    // node itself is created) via `topoSortByFailurePath` below, so `onFailureNodeId` is set
    // correctly at creation — no backfill pass needed for it at all.
    const [sourceNodes, sourceEdges] = await Promise.all([
      db.flowNode.findMany({ where: { flowVersionId: current.id } }),
      db.flowEdge.findMany({ where: { flowVersionId: current.id } }),
    ]);
    const orderedSourceNodes = topoSortByFailurePath(sourceNodes);

    let tick = 0;
    const stamp = () => new Date(input.now.getTime() + tick++);
    const newVersionId = newUlid(stamp());
    const nodeIdMap = new Map(sourceNodes.map((node) => [node.id, newUlid(stamp())]));
    const remapNodeId = (id: string | null): string | null =>
      id === null ? null : (nodeIdMap.get(id) ?? null);

    await db.$transaction([
      db.flowVersion.create({
        data: {
          id: newVersionId,
          flowId: flow.id,
          major: draftVersion.major,
          minor: draftVersion.minor,
          // Not current yet — the Published version stays current (and stays what B-5's
          // execution engine runs) until this draft is itself published. Matches
          // `PrismaAgentRepository.forkOrReuseDraftVersion`'s identical reasoning.
          status: "Draft",
          isCurrent: false,
          // Backfilled below, once the copied nodes exist — see this method's own doc comment.
          entryNodeId: null,
          freeTextEscapeEnabled: current.freeTextEscapeEnabled,
          escapeNodeId: null,
          changeSummary: null,
          createdByStaffUserId: input.actorStaffUserId,
          publishedAt: null,
          deletedAt: null,
          createdAt: input.now,
          updatedAt: input.now,
        },
      }),
      ...orderedSourceNodes.map((node) =>
        db.flowNode.create({
          data: {
            id: nodeIdMap.get(node.id)!,
            flowVersionId: newVersionId,
            key: node.key,
            type: node.type,
            title: node.title,
            canvasX: node.canvasX,
            canvasY: node.canvasY,
            messageText: node.messageText,
            quickActionSetKey: node.quickActionSetKey,
            slotName: node.slotName,
            optionSourceKind: node.optionSourceKind,
            optionSourceRef: node.optionSourceRef,
            staticOptionsJson: node.staticOptionsJson,
            // The real, shared `ToolBinding` this node calls — copied verbatim, never
            // remapped: bindings belong to the agent version, not to any one flow version.
            toolBindingId: node.toolBindingId,
            retryCount: node.retryCount,
            retryOnTimeout: node.retryOnTimeout,
            timeoutMs: node.timeoutMs,
            // Set directly, never backfilled — `orderedSourceNodes`'s topological order
            // guarantees this node's failure-path target was already created above.
            onFailureNodeId: remapNodeId(node.onFailureNodeId),
            handoverReason: node.handoverReason,
            confidenceThreshold: node.confidenceThreshold,
            conditionExpression: node.conditionExpression,
            requiredAssurance: node.requiredAssurance,
            createdAt: input.now,
            updatedAt: input.now,
          },
        }),
      ),
      ...sourceEdges.map((edge) =>
        db.flowEdge.create({
          data: {
            id: newUlid(stamp()),
            flowVersionId: newVersionId,
            // Both endpoints are guaranteed present in `nodeIdMap`: `TR_FlowEdges_sameVersion`
            // already forbids a real edge from referencing a node outside its own version.
            fromNodeId: nodeIdMap.get(edge.fromNodeId)!,
            toNodeId: nodeIdMap.get(edge.toNodeId)!,
            label: edge.label,
            ordinal: edge.ordinal,
            conditionExpression: edge.conditionExpression,
            isDefaultBranch: edge.isDefaultBranch,
            createdAt: input.now,
            updatedAt: input.now,
          },
        }),
      ),
      ...(current.entryNodeId !== null || current.escapeNodeId !== null
        ? [
            db.flowVersion.update({
              where: { id: newVersionId },
              data: {
                entryNodeId: remapNodeId(current.entryNodeId),
                escapeNodeId: remapNodeId(current.escapeNodeId),
              },
            }),
          ]
        : []),
    ]);

    return { flowVersionId: newVersionId };
  }

  async publishVersion(input: {
    readonly flowVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<
    | { readonly ok: true; readonly label: string }
    | { readonly ok: false; readonly reason: "flows.already_published" }
    | { readonly ok: false; readonly reason: "flows.entry_node_required" }
    | { readonly ok: false; readonly reason: "flows.escape_node_required" }
  > {
    const db = getTenantDb(OPERATION);
    const { now, actorStaffUserId } = input;

    const version = await db.flowVersion.findFirstOrThrow({ where: { id: input.flowVersionId } });
    if (version.status === "Published") {
      return { ok: false, reason: "flows.already_published" };
    }
    // Defense in depth — `PublishFlowVersion`'s own check is the primary gate; these mirror
    // the real `CK_FlowVersions_publishedHasEntry`/`publishedHasEscape` constraints exactly.
    if (!version.entryNodeId) {
      return { ok: false, reason: "flows.entry_node_required" };
    }
    if (!version.escapeNodeId || !version.freeTextEscapeEnabled) {
      return { ok: false, reason: "flows.escape_node_required" };
    }

    const publishedNumber = publishedFlowVersionNumber({ major: version.major, minor: version.minor });
    const label = flowVersionLabel(publishedNumber);

    // Un-current whichever version was current before, if it differs — MUST be ordered
    // before this version's own isCurrent flips to true: `UQ_FlowVersions_flowId_current
    // WHERE isCurrent = 1` is checked per-statement (SQL Server does not defer unique-index
    // checks to commit), mirroring `PrismaAgentRepository.publishVersion`'s identical note.
    const previousCurrent = await db.flowVersion.findFirst({
      where: { flowId: version.flowId, isCurrent: true, id: { not: version.id } },
    });

    await db.$transaction([
      ...(previousCurrent
        ? [
            db.flowVersion.update({
              where: { id: previousCurrent.id },
              data: { isCurrent: false, updatedAt: now },
            }),
          ]
        : []),
      db.flowVersion.update({
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
      db.flow.update({
        where: { id: version.flowId },
        data: { status: "Published", currentVersionId: version.id, updatedAt: now },
      }),
    ]);

    return { ok: true, label };
  }

  async listNodes(flowVersionId: string): Promise<readonly FlowNodeRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.flowNode.findMany({
      where: { flowVersionId },
      orderBy: { createdAt: "asc" },
    });
    return rows.map(toNodeRow);
  }

  async getNode(id: string): Promise<FlowNodeRow | null> {
    const db = getTenantDb(OPERATION);
    const row = await db.flowNode.findFirst({ where: { id } });
    return row ? toNodeRow(row) : null;
  }

  async createNode(input: NewFlowNodeInput): Promise<FlowNodeRow> {
    const db = getTenantDb(OPERATION);
    const key = await uniqueNodeKey(db, input.flowVersionId, input.title);
    const row = await db.flowNode.create({
      data: {
        id: newUlid(input.now),
        flowVersionId: input.flowVersionId,
        key,
        type: input.type,
        title: input.title,
        canvasX: input.canvasX,
        canvasY: input.canvasY,
        messageText: input.messageText,
        quickActionSetKey: input.quickActionSetKey,
        slotName: input.slotName,
        optionSourceKind: input.optionSourceKind,
        optionSourceRef: input.optionSourceRef,
        staticOptionsJson: input.staticOptionsJson,
        toolBindingId: input.toolBindingId,
        retryCount: input.retryCount,
        retryOnTimeout: input.retryOnTimeout,
        timeoutMs: input.timeoutMs,
        onFailureNodeId: input.onFailureNodeId,
        handoverReason: input.handoverReason,
        confidenceThreshold: input.confidenceThreshold,
        conditionExpression: input.conditionExpression,
        requiredAssurance: input.requiredAssurance,
        createdAt: input.now,
        updatedAt: input.now,
      },
    });
    return toNodeRow(row);
  }

  async updateNode(input: UpdateFlowNodeInput): Promise<FlowNodeRow> {
    const db = getTenantDb(OPERATION);
    const row = await db.flowNode.update({
      where: { id: input.id },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.canvasX !== undefined ? { canvasX: input.canvasX } : {}),
        ...(input.canvasY !== undefined ? { canvasY: input.canvasY } : {}),
        ...(input.messageText !== undefined ? { messageText: input.messageText } : {}),
        ...(input.quickActionSetKey !== undefined
          ? { quickActionSetKey: input.quickActionSetKey }
          : {}),
        ...(input.slotName !== undefined ? { slotName: input.slotName } : {}),
        ...(input.optionSourceKind !== undefined
          ? { optionSourceKind: input.optionSourceKind }
          : {}),
        ...(input.optionSourceRef !== undefined ? { optionSourceRef: input.optionSourceRef } : {}),
        ...(input.staticOptionsJson !== undefined
          ? { staticOptionsJson: input.staticOptionsJson }
          : {}),
        ...(input.toolBindingId !== undefined ? { toolBindingId: input.toolBindingId } : {}),
        ...(input.retryCount !== undefined ? { retryCount: input.retryCount } : {}),
        ...(input.retryOnTimeout !== undefined ? { retryOnTimeout: input.retryOnTimeout } : {}),
        ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
        ...(input.onFailureNodeId !== undefined ? { onFailureNodeId: input.onFailureNodeId } : {}),
        ...(input.handoverReason !== undefined ? { handoverReason: input.handoverReason } : {}),
        ...(input.confidenceThreshold !== undefined
          ? { confidenceThreshold: input.confidenceThreshold }
          : {}),
        ...(input.conditionExpression !== undefined
          ? { conditionExpression: input.conditionExpression }
          : {}),
        ...(input.requiredAssurance !== undefined
          ? { requiredAssurance: input.requiredAssurance }
          : {}),
        updatedAt: input.now,
      },
    });
    return toNodeRow(row);
  }

  async deleteNode(id: string, flowVersionId: string): Promise<void> {
    const db = getTenantDb(OPERATION);
    const [version, referencingNode, referencingEdges] = await Promise.all([
      db.flowVersion.findFirst({ where: { id: flowVersionId } }),
      db.flowNode.findFirst({ where: { flowVersionId, onFailureNodeId: id } }),
      db.flowEdge.findMany({
        where: { flowVersionId, OR: [{ fromNodeId: id }, { toNodeId: id }] },
      }),
    ]);

    // Root-cause, pre-emptive rejections rather than letting a real FK violation surface as
    // a raw SQL error — `onFailureNodeId`/`entryNodeId`/`escapeNodeId` are all NoAction FKs
    // with no cascade, by design (a silent cascade here would leave a *different* node's own
    // `CK_FlowNodes_toolCallFields` completeness quietly broken).
    if (version && (version.entryNodeId === id || version.escapeNodeId === id)) {
      throw new Error(
        `Cannot delete this node: it is designated as this version's entry or escape node. Reassign that designation to a different node first.`,
      );
    }
    if (referencingNode) {
      throw new Error(
        `Cannot delete this node: node "${referencingNode.title}" targets it as its failure path. Update that node's failure path first.`,
      );
    }

    await db.$transaction([
      ...referencingEdges.map((edge) => db.flowEdge.delete({ where: { id: edge.id } })),
      db.flowNode.delete({ where: { id } }),
    ]);
  }

  async listEdges(flowVersionId: string): Promise<readonly FlowEdgeRow[]> {
    const db = getTenantDb(OPERATION);
    const rows = await db.flowEdge.findMany({
      where: { flowVersionId },
      orderBy: [{ fromNodeId: "asc" }, { ordinal: "asc" }],
    });
    return rows.map(toEdgeRow);
  }

  async createEdge(input: NewFlowEdgeInput): Promise<FlowEdgeWriteResult> {
    const db = getTenantDb(OPERATION);
    // Pre-check `TR_FlowEdges_sameVersion` cheaply rather than relying only on the trigger's
    // post-insert rollback — both endpoints must already exist in this exact version.
    const [fromNode, toNode] = await Promise.all([
      db.flowNode.findFirst({
        where: { id: input.fromNodeId, flowVersionId: input.flowVersionId },
      }),
      db.flowNode.findFirst({ where: { id: input.toNodeId, flowVersionId: input.flowVersionId } }),
    ]);
    if (!fromNode || !toNode) {
      return { ok: false, reason: "flows.endpoint_wrong_version" };
    }

    try {
      const row = await db.flowEdge.create({
        data: {
          id: newUlid(input.now),
          flowVersionId: input.flowVersionId,
          fromNodeId: input.fromNodeId,
          toNodeId: input.toNodeId,
          label: input.label,
          ordinal: input.ordinal,
          conditionExpression: input.conditionExpression,
          isDefaultBranch: input.isDefaultBranch,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { ok: true, edge: toEdgeRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(WRONG_VERSION_FRAGMENT)) {
        return { ok: false, reason: "flows.endpoint_wrong_version" };
      }
      throw error;
    }
  }

  async updateEdge(input: UpdateFlowEdgeInput): Promise<FlowEdgeWriteResult> {
    const db = getTenantDb(OPERATION);
    try {
      const row = await db.flowEdge.update({
        where: { id: input.id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.ordinal !== undefined ? { ordinal: input.ordinal } : {}),
          ...(input.conditionExpression !== undefined
            ? { conditionExpression: input.conditionExpression }
            : {}),
          ...(input.isDefaultBranch !== undefined
            ? { isDefaultBranch: input.isDefaultBranch }
            : {}),
          updatedAt: input.now,
        },
      });
      return { ok: true, edge: toEdgeRow(row) };
    } catch (error) {
      if (error instanceof Error && error.message.includes(WRONG_VERSION_FRAGMENT)) {
        return { ok: false, reason: "flows.endpoint_wrong_version" };
      }
      throw error;
    }
  }

  async deleteEdge(id: string, flowVersionId: string): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.flowEdge.deleteMany({ where: { id, flowVersionId } });
  }

  async setEntryNode(flowVersionId: string, nodeId: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.flowVersion.update({
      where: { id: flowVersionId },
      data: { entryNodeId: nodeId, updatedAt: now },
    });
  }

  async setEscapeNode(flowVersionId: string, nodeId: string, now: Date): Promise<void> {
    const db = getTenantDb(OPERATION);
    await db.flowVersion.update({
      where: { id: flowVersionId },
      data: { escapeNodeId: nodeId, freeTextEscapeEnabled: true, updatedAt: now },
    });
  }
}
