/**
 * In-memory `FlowRepository` — same two rules as every sibling module's fakes
 * (`modules/tools/testing/fakes.ts`'s own doc comment): ids are always generated, never
 * accepted, and every documented rejection (`flows.endpoint_wrong_version`) is reachable
 * from a test. Not a `.test.ts` file — this is test support, imported by tests.
 */

import {
  INITIAL_FLOW_DRAFT_VERSION,
  flowVersionLabel,
  nextFlowDraftVersion,
  publishedFlowVersionNumber,
} from "../domain/flow-version.js";
import { FLOW_ASSISTANT_CONFIG_DEFAULTS } from "../domain/flow-assistant-config.js";
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
} from "../ports/flow-repository.js";
import type {
  FlowAssistantConfigRepository,
  FlowAssistantConfigRow,
  UpdateFlowAssistantConfigInput,
} from "../ports/flow-assistant-config-repository.js";

export class FakeFlowRepository implements FlowRepository {
  private readonly flows = new Map<
    string,
    { id: string; name: string; ownerTenantId: string; currentVersionId: string | null }
  >();
  private readonly versions = new Map<string, FlowVersionRow>();
  private readonly nodes = new Map<string, FlowNodeRow>();
  private readonly edges = new Map<string, FlowEdgeRow>();
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_fake_${this.counter}`;
  }

  seedVersion(row: FlowVersionRow): void {
    this.versions.set(row.id, row);
    if (!this.flows.has(row.flowId)) {
      this.flows.set(row.flowId, {
        id: row.flowId,
        name: "Fixture flow",
        ownerTenantId: "tenant_fixture_1",
        currentVersionId: row.id,
      });
    }
  }

  seedNode(row: FlowNodeRow): void {
    this.nodes.set(row.id, row);
  }

  seedEdge(row: FlowEdgeRow): void {
    this.edges.set(row.id, row);
  }

  async getFlowVersion(flowVersionId: string): Promise<FlowVersionRow | null> {
    return this.versions.get(flowVersionId) ?? null;
  }

  async createFlow(input: {
    readonly name: string;
    readonly ownerTenantId: string;
    readonly createdByStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly flowId: string; readonly flowVersionId: string }> {
    const flowId = this.nextId("flow");
    const versionId = this.nextId("flowver");
    this.flows.set(flowId, {
      id: flowId,
      name: input.name,
      ownerTenantId: input.ownerTenantId,
      currentVersionId: versionId,
    });
    this.versions.set(versionId, {
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
      publishedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return { flowId, flowVersionId: versionId };
  }

  async forkOrReuseDraftVersion(input: {
    readonly flowId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly flowVersionId: string }> {
    void input.actorStaffUserId;
    const flow = this.flows.get(input.flowId);
    if (!flow || !flow.currentVersionId) {
      throw new Error(`No such flow (or it has no current version): "${input.flowId}".`);
    }
    const current = this.versions.get(flow.currentVersionId);
    if (!current) throw new Error(`Flow "${input.flowId}" current version is missing.`);
    if (current.status !== "Published") return { flowVersionId: current.id };

    const allForFlow = [...this.versions.values()].filter((v) => v.flowId === input.flowId);
    const highest = allForFlow.reduce((max, v) =>
      v.major > max.major || (v.major === max.major && v.minor > max.minor) ? v : max,
    );
    const draft = nextFlowDraftVersion({ major: highest.major, minor: highest.minor });
    const versionId = this.nextId("flowver");
    this.versions.set(versionId, {
      id: versionId,
      flowId: input.flowId,
      major: draft.major,
      minor: draft.minor,
      status: "Draft",
      isCurrent: false,
      entryNodeId: null,
      freeTextEscapeEnabled: true,
      escapeNodeId: null,
      changeSummary: null,
      publishedAt: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    return { flowVersionId: versionId };
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
    const version = this.versions.get(input.flowVersionId);
    if (!version) throw new Error(`No such flow version: "${input.flowVersionId}".`);
    if (version.status === "Published") return { ok: false, reason: "flows.already_published" };
    if (!version.entryNodeId) return { ok: false, reason: "flows.entry_node_required" };
    if (!version.escapeNodeId || !version.freeTextEscapeEnabled) {
      return { ok: false, reason: "flows.escape_node_required" };
    }

    const publishedNumber = publishedFlowVersionNumber({ major: version.major, minor: version.minor });
    const label = flowVersionLabel(publishedNumber);

    for (const other of this.versions.values()) {
      if (other.flowId === version.flowId && other.isCurrent && other.id !== version.id) {
        this.versions.set(other.id, { ...other, isCurrent: false, updatedAt: input.now });
      }
    }
    this.versions.set(version.id, {
      ...version,
      major: publishedNumber.major,
      minor: publishedNumber.minor,
      status: "Published",
      isCurrent: true,
      publishedAt: input.now,
      changeSummary: input.changeSummary,
      updatedAt: input.now,
    });
    const flow = this.flows.get(version.flowId);
    if (flow) this.flows.set(flow.id, { ...flow, currentVersionId: version.id });

    return { ok: true, label };
  }

  async listNodes(flowVersionId: string): Promise<readonly FlowNodeRow[]> {
    return [...this.nodes.values()].filter((n) => n.flowVersionId === flowVersionId);
  }

  async getNode(id: string): Promise<FlowNodeRow | null> {
    return this.nodes.get(id) ?? null;
  }

  async createNode(input: NewFlowNodeInput): Promise<FlowNodeRow> {
    const id = this.nextId("flownode");
    const taken = new Set(
      [...this.nodes.values()]
        .filter((n) => n.flowVersionId === input.flowVersionId)
        .map((n) => n.key),
    );
    const base =
      input.title
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "") || "node";
    let key = base;
    for (let suffix = 2; taken.has(key); suffix += 1) key = `${base}_${suffix}`;

    const row: FlowNodeRow = {
      id,
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
    };
    this.nodes.set(id, row);
    return row;
  }

  async updateNode(input: UpdateFlowNodeInput): Promise<FlowNodeRow> {
    const existing = this.nodes.get(input.id);
    if (!existing) throw new Error(`No such flow node: "${input.id}".`);
    const updated: FlowNodeRow = {
      ...existing,
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.canvasX !== undefined ? { canvasX: input.canvasX } : {}),
      ...(input.canvasY !== undefined ? { canvasY: input.canvasY } : {}),
      ...(input.messageText !== undefined ? { messageText: input.messageText } : {}),
      ...(input.quickActionSetKey !== undefined
        ? { quickActionSetKey: input.quickActionSetKey }
        : {}),
      ...(input.slotName !== undefined ? { slotName: input.slotName } : {}),
      ...(input.optionSourceKind !== undefined ? { optionSourceKind: input.optionSourceKind } : {}),
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
    };
    this.nodes.set(input.id, updated);
    return updated;
  }

  async deleteNode(id: string, flowVersionId: string): Promise<void> {
    const version = [...this.versions.values()].find((v) => v.flowId && v.id === flowVersionId);
    if (version && (version.entryNodeId === id || version.escapeNodeId === id)) {
      throw new Error(
        `Cannot delete this node: it is designated as this version's entry or escape node.`,
      );
    }
    const referencing = [...this.nodes.values()].find(
      (n) => n.flowVersionId === flowVersionId && n.onFailureNodeId === id,
    );
    if (referencing) {
      throw new Error(
        `Cannot delete this node: node "${referencing.title}" targets it as its failure path.`,
      );
    }
    for (const edge of [...this.edges.values()]) {
      if (
        edge.flowVersionId === flowVersionId &&
        (edge.fromNodeId === id || edge.toNodeId === id)
      ) {
        this.edges.delete(edge.id);
      }
    }
    this.nodes.delete(id);
  }

  async listEdges(flowVersionId: string): Promise<readonly FlowEdgeRow[]> {
    return [...this.edges.values()].filter((e) => e.flowVersionId === flowVersionId);
  }

  async createEdge(input: NewFlowEdgeInput): Promise<FlowEdgeWriteResult> {
    const fromExists = [...this.nodes.values()].some(
      (n) => n.id === input.fromNodeId && n.flowVersionId === input.flowVersionId,
    );
    const toExists = [...this.nodes.values()].some(
      (n) => n.id === input.toNodeId && n.flowVersionId === input.flowVersionId,
    );
    if (!fromExists || !toExists) return { ok: false, reason: "flows.endpoint_wrong_version" };

    const id = this.nextId("flowedge");
    const row: FlowEdgeRow = {
      id,
      flowVersionId: input.flowVersionId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      label: input.label,
      ordinal: input.ordinal,
      conditionExpression: input.conditionExpression,
      isDefaultBranch: input.isDefaultBranch,
      createdAt: input.now,
      updatedAt: input.now,
    };
    this.edges.set(id, row);
    return { ok: true, edge: row };
  }

  async updateEdge(input: UpdateFlowEdgeInput): Promise<FlowEdgeWriteResult> {
    const existing = this.edges.get(input.id);
    if (!existing) throw new Error(`No such flow edge: "${input.id}".`);
    const updated: FlowEdgeRow = {
      ...existing,
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.ordinal !== undefined ? { ordinal: input.ordinal } : {}),
      ...(input.conditionExpression !== undefined
        ? { conditionExpression: input.conditionExpression }
        : {}),
      ...(input.isDefaultBranch !== undefined ? { isDefaultBranch: input.isDefaultBranch } : {}),
      updatedAt: input.now,
    };
    this.edges.set(input.id, updated);
    return { ok: true, edge: updated };
  }

  async deleteEdge(id: string, flowVersionId: string): Promise<void> {
    const existing = this.edges.get(id);
    if (existing && existing.flowVersionId === flowVersionId) this.edges.delete(id);
  }

  async setEntryNode(flowVersionId: string, nodeId: string, now: Date): Promise<void> {
    const existing = this.versions.get(flowVersionId);
    if (!existing) throw new Error(`No such flow version: "${flowVersionId}".`);
    this.versions.set(flowVersionId, { ...existing, entryNodeId: nodeId, updatedAt: now });
  }

  async setEscapeNode(flowVersionId: string, nodeId: string, now: Date): Promise<void> {
    const existing = this.versions.get(flowVersionId);
    if (!existing) throw new Error(`No such flow version: "${flowVersionId}".`);
    this.versions.set(flowVersionId, {
      ...existing,
      escapeNodeId: nodeId,
      freeTextEscapeEnabled: true,
      updatedAt: now,
    });
  }
}

export function flowVersionRowFixture(overrides: Partial<FlowVersionRow> = {}): FlowVersionRow {
  return {
    id: "flowver_fixture_1",
    flowId: "flow_fixture_1",
    major: 0,
    minor: 1,
    status: "Draft",
    isCurrent: true,
    entryNodeId: null,
    freeTextEscapeEnabled: true,
    escapeNodeId: null,
    changeSummary: null,
    publishedAt: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

export function flowNodeRowFixture(overrides: Partial<FlowNodeRow> = {}): FlowNodeRow {
  return {
    id: "flownode_fixture_1",
    flowVersionId: "flowver_fixture_1",
    key: "welcome_message",
    type: "Message",
    title: "Welcome message",
    canvasX: 0,
    canvasY: 0,
    messageText: "Welcome! How can I help?",
    quickActionSetKey: null,
    slotName: null,
    optionSourceKind: null,
    optionSourceRef: null,
    staticOptionsJson: null,
    toolBindingId: null,
    retryCount: null,
    retryOnTimeout: null,
    timeoutMs: null,
    onFailureNodeId: null,
    handoverReason: null,
    confidenceThreshold: null,
    conditionExpression: null,
    requiredAssurance: null,
    createdAt: new Date("2026-09-01T00:00:00.000Z"),
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

export class FakeFlowAssistantConfigRepository implements FlowAssistantConfigRepository {
  private config: FlowAssistantConfigRow | null = null;

  async ensureTenantConfig(now: Date): Promise<FlowAssistantConfigRow> {
    this.config ??= {
      primaryModel: FLOW_ASSISTANT_CONFIG_DEFAULTS.primaryModel,
      fallbackModel: FLOW_ASSISTANT_CONFIG_DEFAULTS.fallbackModel,
      updatedByStaffUserId: null,
      updatedAt: now,
    };
    return this.config;
  }

  async updateTenantConfig(input: UpdateFlowAssistantConfigInput): Promise<FlowAssistantConfigRow> {
    await this.ensureTenantConfig(input.now);
    this.config = {
      primaryModel: input.primaryModel,
      fallbackModel: input.fallbackModel,
      updatedByStaffUserId: input.updatedByStaffUserId,
      updatedAt: input.now,
    };
    return this.config;
  }
}
