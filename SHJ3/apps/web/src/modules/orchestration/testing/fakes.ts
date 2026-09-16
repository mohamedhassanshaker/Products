/** In-memory fakes for every `orchestration` port — same convention as `escalation/testing/
 *  fakes.ts`: constructor-free, `seed()` to prime state, no database required. */

import type {
  CreateDefaultRouterConfigInput,
  RouterConfigRepository,
  RouterConfigRow,
  UpdateRouterConfigInput,
} from "../ports/router-config-repository.js";
import type {
  OrchestrationTraceDetail,
  OrchestrationTraceRepository,
  OrchestrationTraceSummaryRow,
} from "../ports/orchestration-trace-repository.js";
import type { PublishedAgentPort, PublishedAgentSummary } from "../ports/published-agent-port.js";
import type {
  PipelineValidationClient,
  ValidatePipelineConditionResult,
  ValidatePipelineGraphInput,
  ValidatePipelineGraphResult,
} from "../ports/pipeline-validation-client.js";
import {
  INITIAL_PIPELINE_DRAFT_VERSION,
  nextPipelineDraftVersion,
  pipelineVersionLabel,
  publishedPipelineVersionNumber,
} from "../domain/pipeline-version.js";
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
} from "../ports/pipeline-repository.js";

export class FakeRouterConfigRepository implements RouterConfigRepository {
  private row: RouterConfigRow | null = null;
  readonly created: CreateDefaultRouterConfigInput[] = [];

  seed(row: RouterConfigRow): void {
    this.row = row;
  }

  async getSingleton(): Promise<RouterConfigRow | null> {
    return this.row;
  }

  async createDefault(input: CreateDefaultRouterConfigInput): Promise<void> {
    this.created.push(input);
    this.row = {
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
      fallbackAgentName: null,
      minRoutingConfidence: 0.3,
      updatedAt: input.now,
      activePipelineVersionId: null,
    };
  }

  async updateTenantConfig(input: UpdateRouterConfigInput): Promise<RouterConfigRow> {
    if (!this.row) throw new Error("FakeRouterConfigRepository: no singleton seeded yet");
    this.row = {
      ...input,
      // `fallbackAgentName` is server-derived, never part of the update input — a test
      // that needs a non-null name re-seeds the row directly via `seed()`.
      fallbackAgentName: this.row.fallbackAgentName,
      // `activePipelineVersionId` is untouched by an ordinary config edit — only
      // `setActivePipelineVersion` below changes it.
      activePipelineVersionId: this.row.activePipelineVersionId,
      updatedAt: new Date(),
    };
    return this.row;
  }

  async setActivePipelineVersion(input: {
    readonly pipelineVersionId: string | null;
    readonly now: Date;
  }): Promise<RouterConfigRow> {
    if (!this.row) throw new Error("FakeRouterConfigRepository: no singleton seeded yet");
    this.row = {
      ...this.row,
      activePipelineVersionId: input.pipelineVersionId,
      updatedAt: input.now,
    };
    return this.row;
  }
}

/** In-memory `PublishedAgentPort` — same shape as the real `orchestrator/composition.ts`
 *  adapter, minus the real cross-feature call to `agents`, so `UpdateRouterConfig`'s tests
 *  never need to import anything from `modules/agents` (which `boundaries/element-types`
 *  forbids for this feature module anyway — see the port's own doc comment). */
export class FakePublishedAgentPort implements PublishedAgentPort {
  private readonly published = new Set<string>();

  seedPublished(id: string): void {
    this.published.add(id);
  }

  async listPublished(): Promise<readonly PublishedAgentSummary[]> {
    return [...this.published].map((id) => ({ id }));
  }
}

export class FakeOrchestrationTraceRepository implements OrchestrationTraceRepository {
  private readonly rows = new Map<string, OrchestrationTraceDetail>();

  seed(row: OrchestrationTraceDetail): void {
    this.rows.set(row.id, row);
  }

  async listRecent(limit: number): Promise<readonly OrchestrationTraceSummaryRow[]> {
    return [...this.rows.values()]
      .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())
      .slice(0, limit);
  }

  async getDetail(traceId: string): Promise<OrchestrationTraceDetail | null> {
    return this.rows.get(traceId) ?? null;
  }
}

/** In-memory `PipelineRepository` — same two rules as `modules/flows/testing/fakes.ts`'s own
 *  `FakeFlowRepository`: ids are always generated, never accepted, and every documented
 *  rejection (`orchestration.pipeline.endpoint_wrong_version`, `.non_homogeneous_fan_out`,
 *  `.already_published`, `.version_is_current`) is reachable from a test. */
export class FakePipelineRepository implements PipelineRepository {
  private readonly designs = new Map<string, PipelineDesignRow>();
  private readonly versions = new Map<string, PipelineVersionRow>();
  private readonly nodes = new Map<string, PipelineNodeRow>();
  private readonly edges = new Map<string, PipelineEdgeRow>();
  private readonly history = new Map<string, PipelineVersionHistoryEntryRow[]>();
  private counter = 0;

  private nextId(prefix: string): string {
    this.counter += 1;
    return `${prefix}_fake_${this.counter}`;
  }

  seedDesign(row: PipelineDesignRow): void {
    this.designs.set(row.id, row);
  }

  seedVersion(row: PipelineVersionRow): void {
    this.versions.set(row.id, row);
    if (!this.designs.has(row.pipelineDesignId)) {
      this.designs.set(row.pipelineDesignId, {
        id: row.pipelineDesignId,
        name: "Fixture pipeline",
        slug: "fixture-pipeline",
        description: null,
        status: row.status,
        currentVersionId: row.id,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
  }

  seedNode(row: PipelineNodeRow): void {
    this.nodes.set(row.id, row);
  }

  seedEdge(row: PipelineEdgeRow): void {
    this.edges.set(row.id, row);
  }

  async listDesigns(): Promise<readonly PipelineDesignRow[]> {
    return [...this.designs.values()].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
  }

  async getDesign(pipelineDesignId: string): Promise<PipelineDesignRow | null> {
    return this.designs.get(pipelineDesignId) ?? null;
  }

  async getPipelineVersion(pipelineVersionId: string): Promise<PipelineVersionRow | null> {
    return this.versions.get(pipelineVersionId) ?? null;
  }

  async getCanvas(pipelineVersionId: string): Promise<PipelineCanvas | null> {
    const version = this.versions.get(pipelineVersionId);
    if (!version) return null;
    return {
      version,
      nodes: [...this.nodes.values()].filter((n) => n.pipelineVersionId === pipelineVersionId),
      edges: [...this.edges.values()].filter((e) => e.pipelineVersionId === pipelineVersionId),
    };
  }

  async listVersionHistory(
    pipelineDesignId: string,
  ): Promise<readonly PipelineVersionHistoryEntryRow[]> {
    return [...(this.history.get(pipelineDesignId) ?? [])].sort(
      (a, b) => b.occurredAt.getTime() - a.occurredAt.getTime(),
    );
  }

  private appendHistory(entry: PipelineVersionHistoryEntryRow, pipelineDesignId: string): void {
    const existing = this.history.get(pipelineDesignId) ?? [];
    existing.push(entry);
    this.history.set(pipelineDesignId, existing);
  }

  async createPipeline(input: {
    readonly name: string;
    readonly ownerTenantId: string;
    readonly createdByStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly pipelineDesignId: string; readonly pipelineVersionId: string }> {
    const designId = this.nextId("pd");
    const versionId = this.nextId("pv");
    const startNodeId = this.nextId("pnd");

    this.designs.set(designId, {
      id: designId,
      name: input.name,
      slug: input.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      description: null,
      status: "Draft",
      currentVersionId: versionId,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.versions.set(versionId, {
      id: versionId,
      pipelineDesignId: designId,
      major: INITIAL_PIPELINE_DRAFT_VERSION.major,
      minor: INITIAL_PIPELINE_DRAFT_VERSION.minor,
      status: "Draft",
      isCurrent: true,
      entryNodeId: startNodeId,
      maxTotalHops: 10,
      costCeilingTokens: 8000,
      costCeilingMicroAed: 350_000,
      defaultMergePolicy: "DeduplicateOverlap",
      defaultConflictResolution: "HighestConfidence",
      routingStrategy: "IntentClassifier",
      minRoutingConfidence: 0.3,
      fallbackAgentId: null,
      changeSummary: null,
      publishedAt: null,
      clonedFromVersionId: null,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.nodes.set(startNodeId, {
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
    });
    this.appendHistory(
      {
        id: this.nextId("pvh"),
        pipelineVersionId: versionId,
        kind: "Created",
        note: `Created ${input.name}.`,
        fromVersionId: null,
        actorStaffUserId: input.createdByStaffUserId,
        occurredAt: input.now,
      },
      designId,
    );

    return { pipelineDesignId: designId, pipelineVersionId: versionId };
  }

  async forkOrReuseDraftVersion(input: {
    readonly pipelineDesignId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<{ readonly pipelineVersionId: string }> {
    const design = this.designs.get(input.pipelineDesignId);
    if (!design || !design.currentVersionId) {
      throw new Error(
        `FakePipelineRepository: design "${input.pipelineDesignId}" has no current version`,
      );
    }
    const current = this.versions.get(design.currentVersionId);
    if (!current) {
      throw new Error(`FakePipelineRepository: version "${design.currentVersionId}" not seeded`);
    }
    if (current.status !== "Published") {
      return { pipelineVersionId: current.id };
    }

    // Mirrors `PrismaPipelineRepository.forkOrReuseDraftVersion`'s own real, live-caught
    // fix: `currentVersionId` never moves off the Published version on its own, so a
    // second call for the same design must find the already-forked Draft directly rather
    // than forking a duplicate.
    const existingDraft = [...this.versions.values()].find(
      (v) => v.pipelineDesignId === design.id && v.status === "Draft",
    );
    if (existingDraft) {
      return { pipelineVersionId: existingDraft.id };
    }

    const everyVersion = [...this.versions.values()].filter(
      (v) => v.pipelineDesignId === design.id,
    );
    const highest = everyVersion.reduce((a, b) =>
      a.major !== b.major ? (a.major > b.major ? a : b) : a.minor > b.minor ? a : b,
    );
    const draftVersion = nextPipelineDraftVersion({ major: highest.major, minor: highest.minor });

    const sourceNodes = [...this.nodes.values()].filter((n) => n.pipelineVersionId === current.id);
    const sourceEdges = [...this.edges.values()].filter((e) => e.pipelineVersionId === current.id);
    const newVersionId = this.nextId("pv");
    const nodeIdMap = new Map(sourceNodes.map((n) => [n.id, this.nextId("pnd")]));

    for (const node of sourceNodes) {
      const newId = nodeIdMap.get(node.id)!;
      this.nodes.set(newId, { ...node, id: newId, pipelineVersionId: newVersionId });
    }
    for (const edge of sourceEdges) {
      const newId = this.nextId("pge");
      this.edges.set(newId, {
        ...edge,
        id: newId,
        pipelineVersionId: newVersionId,
        fromNodeId: nodeIdMap.get(edge.fromNodeId)!,
        toNodeId: nodeIdMap.get(edge.toNodeId)!,
      });
    }
    this.versions.set(newVersionId, {
      ...current,
      id: newVersionId,
      major: draftVersion.major,
      minor: draftVersion.minor,
      status: "Draft",
      isCurrent: false,
      entryNodeId: current.entryNodeId ? (nodeIdMap.get(current.entryNodeId) ?? null) : null,
      changeSummary: null,
      publishedAt: null,
      clonedFromVersionId: current.id,
      createdAt: input.now,
      updatedAt: input.now,
    });
    this.appendHistory(
      {
        id: this.nextId("pvh"),
        pipelineVersionId: newVersionId,
        kind: "Cloned",
        note: `Cloned from v${current.major}.${current.minor}.`,
        fromVersionId: current.id,
        actorStaffUserId: input.actorStaffUserId,
        occurredAt: input.now,
      },
      design.id,
    );

    return { pipelineVersionId: newVersionId };
  }

  async publishVersion(input: {
    readonly pipelineVersionId: string;
    readonly changeSummary: string | null;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<PublishPipelineVersionResult> {
    const version = this.versions.get(input.pipelineVersionId);
    if (!version) {
      throw new Error(`FakePipelineRepository: version "${input.pipelineVersionId}" not seeded`);
    }
    if (version.status === "Published") {
      return { ok: false, reason: "orchestration.pipeline.already_published" };
    }
    const publishedNumber = publishedPipelineVersionNumber({
      major: version.major,
      minor: version.minor,
    });
    const label = pipelineVersionLabel(publishedNumber);

    for (const other of this.versions.values()) {
      if (other.pipelineDesignId === version.pipelineDesignId && other.id !== version.id && other.isCurrent) {
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
    const design = this.designs.get(version.pipelineDesignId);
    if (design) {
      this.designs.set(design.id, {
        ...design,
        status: "Published",
        currentVersionId: version.id,
        updatedAt: input.now,
      });
    }
    this.appendHistory(
      {
        id: this.nextId("pvh"),
        pipelineVersionId: version.id,
        kind: "Published",
        note: `Published ${label}.`,
        fromVersionId: null,
        actorStaffUserId: input.actorStaffUserId,
        occurredAt: input.now,
      },
      version.pipelineDesignId,
    );

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
    const target = this.versions.get(input.targetVersionId);
    if (!target) {
      throw new Error(`FakePipelineRepository: version "${input.targetVersionId}" not seeded`);
    }
    if (target.isCurrent) {
      return { ok: false, reason: "orchestration.pipeline.version_is_current" };
    }
    for (const other of this.versions.values()) {
      if (other.pipelineDesignId === target.pipelineDesignId && other.isCurrent) {
        this.versions.set(other.id, { ...other, isCurrent: false, updatedAt: input.now });
      }
    }
    this.versions.set(target.id, { ...target, isCurrent: true, updatedAt: input.now });
    const design = this.designs.get(target.pipelineDesignId);
    if (design) {
      this.designs.set(design.id, {
        ...design,
        currentVersionId: target.id,
        updatedAt: input.now,
      });
    }
    this.appendHistory(
      {
        id: this.nextId("pvh"),
        pipelineVersionId: target.id,
        kind: "RolledBack",
        note: `Rolled back to v${target.major}.${target.minor}.`,
        fromVersionId: target.id,
        actorStaffUserId: input.actorStaffUserId,
        occurredAt: input.now,
      },
      target.pipelineDesignId,
    );
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
    const existing = this.versions.get(input.pipelineVersionId);
    if (!existing) {
      throw new Error(`FakePipelineRepository: version "${input.pipelineVersionId}" not seeded`);
    }
    const updated: PipelineVersionRow = {
      ...existing,
      maxTotalHops: input.maxTotalHops,
      costCeilingTokens: input.costCeilingTokens,
      costCeilingMicroAed: input.costCeilingMicroAed,
      defaultMergePolicy: input.defaultMergePolicy,
      defaultConflictResolution: input.defaultConflictResolution,
      routingStrategy: input.routingStrategy,
      minRoutingConfidence: input.minRoutingConfidence,
      fallbackAgentId: input.fallbackAgentId,
      updatedAt: input.now,
    };
    this.versions.set(input.pipelineVersionId, updated);
    return updated;
  }

  async createNode(input: NewPipelineNodeInput): Promise<PipelineNodeRow> {
    const id = this.nextId("pnd");
    const row: PipelineNodeRow = {
      id,
      pipelineVersionId: input.pipelineVersionId,
      key: `node_${this.counter}`,
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
    };
    this.nodes.set(id, row);
    return row;
  }

  async updateNode(input: UpdatePipelineNodeInput): Promise<PipelineNodeRow> {
    const existing = this.nodes.get(input.id);
    if (!existing) throw new Error(`FakePipelineRepository: node "${input.id}" not seeded`);
    const updated: PipelineNodeRow = {
      ...existing,
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
      ...(input.inputContextMode !== undefined ? { inputContextMode: input.inputContextMode } : {}),
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
        ? { costCeilingMicroAedOverride: input.costCeilingMicroAedOverride }
        : {}),
      ...(input.timeoutMsOverride !== undefined ? { timeoutMsOverride: input.timeoutMsOverride } : {}),
      ...(input.onErrorPolicy !== undefined ? { onErrorPolicy: input.onErrorPolicy } : {}),
    };
    this.nodes.set(input.id, updated);
    return updated;
  }

  async deleteNode(id: string, pipelineVersionId: string): Promise<void> {
    const existing = this.nodes.get(id);
    if (existing && existing.pipelineVersionId === pipelineVersionId) {
      this.nodes.delete(id);
      for (const edge of [...this.edges.values()]) {
        if (edge.fromNodeId === id || edge.toNodeId === id) this.edges.delete(edge.id);
      }
    }
  }

  async createEdge(input: NewPipelineEdgeInput): Promise<PipelineEdgeWriteResult> {
    const fromNode = this.nodes.get(input.fromNodeId);
    const toNode = this.nodes.get(input.toNodeId);
    if (
      !fromNode ||
      !toNode ||
      fromNode.pipelineVersionId !== input.pipelineVersionId ||
      toNode.pipelineVersionId !== input.pipelineVersionId
    ) {
      return { ok: false, reason: "orchestration.pipeline.endpoint_wrong_version" };
    }
    if (input.kind !== "LoopBack") {
      const siblingKinds = [...this.edges.values()]
        .filter((e) => e.fromNodeId === input.fromNodeId && e.kind !== "LoopBack")
        .map((e) => e.kind);
      const wouldBeKinds = [...siblingKinds, input.kind];
      const allSequential = wouldBeKinds.every((k) => k === "Sequential");
      const allParallel = wouldBeKinds.every((k) => k === "Parallel");
      const sequentialCountOk = wouldBeKinds.filter((k) => k === "Sequential").length <= 1;
      if (!((allSequential && sequentialCountOk) || allParallel)) {
        return { ok: false, reason: "orchestration.pipeline.non_homogeneous_fan_out" };
      }
    }
    const id = this.nextId("pge");
    const row: PipelineEdgeRow = {
      id,
      pipelineVersionId: input.pipelineVersionId,
      fromNodeId: input.fromNodeId,
      toNodeId: input.toNodeId,
      kind: input.kind,
      ordinal: input.ordinal,
      label: input.label,
      maxIterations: input.maxIterations,
      conditionExpression: input.conditionExpression,
    };
    this.edges.set(id, row);
    return { ok: true, edge: row };
  }

  async updateEdge(input: UpdatePipelineEdgeInput): Promise<PipelineEdgeWriteResult> {
    const existing = this.edges.get(input.id);
    if (!existing) throw new Error(`FakePipelineRepository: edge "${input.id}" not seeded`);
    const updated: PipelineEdgeRow = {
      ...existing,
      ...(input.kind !== undefined ? { kind: input.kind } : {}),
      ...(input.ordinal !== undefined ? { ordinal: input.ordinal } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.maxIterations !== undefined ? { maxIterations: input.maxIterations } : {}),
      ...(input.conditionExpression !== undefined
        ? { conditionExpression: input.conditionExpression }
        : {}),
    };
    this.edges.set(input.id, updated);
    return { ok: true, edge: updated };
  }

  async deleteEdge(id: string, pipelineVersionId: string): Promise<void> {
    const existing = this.edges.get(id);
    if (existing && existing.pipelineVersionId === pipelineVersionId) {
      this.edges.delete(id);
    }
  }

  async setEntryNode(pipelineVersionId: string, nodeId: string, now: Date): Promise<void> {
    const existing = this.versions.get(pipelineVersionId);
    if (!existing) throw new Error(`FakePipelineRepository: version "${pipelineVersionId}" not seeded`);
    this.versions.set(pipelineVersionId, { ...existing, entryNodeId: nodeId, updatedAt: now });
  }

  async recordVersionActivation(input: {
    readonly pipelineVersionId: string;
    readonly actorStaffUserId: string;
    readonly now: Date;
  }): Promise<void> {
    const version = this.versions.get(input.pipelineVersionId);
    if (!version) {
      throw new Error(`FakePipelineRepository: version "${input.pipelineVersionId}" not seeded`);
    }
    this.appendHistory(
      {
        id: this.nextId("pvh"),
        pipelineVersionId: version.id,
        kind: "Activated",
        note: `Activated v${version.major}.${version.minor}.`,
        fromVersionId: null,
        actorStaffUserId: input.actorStaffUserId,
        occurredAt: input.now,
      },
      version.pipelineDesignId,
    );
  }
}

/** In-memory `PipelineValidationClient` — always reports "valid, no issues" by default, so
 *  a test exercising the happy path never needs a real `apps/ai` call. `queueGraphResult`/
 *  `queueConditionResult` let a test force a specific server-side rejection instead. */
export class FakePipelineValidationClient implements PipelineValidationClient {
  private graphResult: ValidatePipelineGraphResult = { valid: true, issues: [] };
  private conditionResult: ValidatePipelineConditionResult = {
    valid: true,
    normalized: null,
    issues: [],
  };
  readonly graphCalls: ValidatePipelineGraphInput[] = [];
  readonly conditionCalls: { expression: string; knownNodeKeys: readonly string[] }[] = [];

  queueGraphResult(result: ValidatePipelineGraphResult): void {
    this.graphResult = result;
  }

  queueConditionResult(result: ValidatePipelineConditionResult): void {
    this.conditionResult = result;
  }

  async validateGraph(input: ValidatePipelineGraphInput): Promise<ValidatePipelineGraphResult> {
    this.graphCalls.push(input);
    return this.graphResult;
  }

  async validateCondition(
    expression: string,
    knownNodeKeys: readonly string[],
  ): Promise<ValidatePipelineConditionResult> {
    this.conditionCalls.push({ expression, knownNodeKeys });
    return this.conditionResult;
  }
}
