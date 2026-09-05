import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatRadioModule } from '@angular/material/radio';
import { MatSelectModule } from '@angular/material/select';
import type {
  GraphNode,
  HandoffNode,
  HitlGateDto,
  HitlNode,
  JoinPolicy,
  LlmNode,
  LoopNode,
  NodeEdgeType,
  ParallelNode,
  ProviderCredentialDto,
  ProviderDefinitionDto,
  RetrieveNode,
  RouterNode,
  SkillDto,
  SkillNode,
  SpeakNode,
  StateNode,
  SubAgentNode,
  TenantListItemDto,
  ToolDto,
  ToolNode,
} from '@liveavatar/contracts';
import { generateBranchId } from '../../store/node-factory';

/** Data passed to `MatDialog.open(NodeInspectorComponent, { data })`. */
export interface NodeInspectorData {
  node: GraphNode;
  /** Every other node in the graph (self excluded), for edge/branch/next-node target pickers. */
  otherNodes: GraphNode[];
  definitions: ProviderDefinitionDto[];
  credentials: ProviderCredentialDto[];
  tools: ToolDto[];
  /** Phase 13 (BL-049/050/051) — every tenant skill, for the Skill node's `skill_id` picker. */
  skills: SkillDto[];
  /** Phase 14 (BL-052/053) — every tenant HITL gate, for the HITL node's `gate_id` picker. */
  gates: HitlGateDto[];
  /**
   * Phase 15 (BL-058) — every tenant this admin can see, for the Sub-agent
   * node's `target_tenant_id` picker. Reuses `TenantsApiService.list()` (the
   * same source `TenantSelectComponent` calls elsewhere in this app) rather
   * than a new endpoint. Deliberately unfiltered — "target has no published
   * config" / "self-reference" / "nesting too deep" are all caught by the
   * backend's V-3 rule and surfaced as inline `CONFIG_SUBAGENT_*` node
   * errors (`errorsByNode`), the same as every other `CONFIG_*` node error
   * in this tab.
   */
  tenants: TenantListItemDto[];
}

const EDGE_ACTIONS: NodeEdgeType['action'][] = ['degrade', 'end_turn', 'goto'];

/**
 * Rough, client-side-only per-node-type latency estimate (ms) for the
 * Parallel inspector's branch table (Phase 11, BL-042). Mirrors
 * `apps/api/.../domain/critical-path.ts`'s `DEFAULT_COST_MS` table, but only
 * looks up a branch's own entry node's type — a shallow, single-node
 * lookup, not that file's real recursive `maxChainCost` walk — because no
 * backend endpoint exposes a live per-branch number to this dialog (out of
 * this phase's explicit scope). Always rendered with an "(estimate)" suffix
 * in the template so it's never mistaken for the authoritative
 * backend-computed critical-path number.
 */
const ESTIMATED_NODE_COST_MS: Partial<Record<GraphNode['type'], number>> = {
  llm: 900,
  tool: 400,
  retrieve: 0,
  router: 150,
  speak: 0,
  end: 0,
  parallel: 0,
  loop: 0,
  skill: 1500,
  // R-H4: a blocking gate is unbounded, not merely large — omitted here
  // (falls back to the `?? 0` default below) rather than assigned any
  // number, so a Parallel branch that fans into a HITL node never shows a
  // falsely-precise estimate.
  // Phase 15 (BL-058/059/060) — Sub-agent has a real budget_ms (mirrors its
  // own schema default); Handoff/State cost ~0 (Handoff is a terminal
  // intent-record, State is an in-memory read/write).
  subagent: 4000,
  handoff: 0,
  state: 0,
};

/**
 * Node inspector — side-panel/modal (A3.7's field content, not its visual
 * layout, per `UX_SCOPE.md` "Reasoning tab"). Reuses the app's existing APG
 * dialog primitive (`MatDialogModule`, same as `ConfirmDialogComponent`/
 * `ToolDialogComponent`) rather than inventing a new overlay.
 *
 * Built as plain component state (not `ReactiveFormsModule`) because a
 * node's field *set* is fixed by its (immutable, chosen-at-creation) `type`
 * — there is no dynamic form-shape problem to solve, just per-type field
 * visibility, so template-driven `[(ngModel)]` bindings over signals stay
 * simpler than a reactive `FormGroup` superset (CLAUDE.md "Simplicity
 * First").
 */
@Component({
  selector: 'la-node-inspector',
  standalone: true,
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatRadioModule, MatSelectModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './node-inspector.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', './node-inspector.component.scss'],
})
export class NodeInspectorComponent {
  readonly data = inject<NodeInspectorData>(MAT_DIALOG_DATA);
  private readonly dialogRef = inject(MatDialogRef<NodeInspectorComponent, GraphNode | undefined>);

  readonly nodeType = this.data.node.type;
  readonly edgeActions = EDGE_ACTIONS;
  readonly otherNodes = this.data.otherNodes;

  // Common fields (R-G2/R-G7 — every node has these).
  readonly name = signal(this.data.node.name);
  readonly lane = signal(this.data.node.lane);
  readonly onErrorAction = signal(this.data.node.on_error.action);
  readonly onErrorTarget = signal(this.data.node.on_error.target_node_id ?? '');
  readonly onDeadlineAction = signal(this.data.node.on_deadline.action);
  readonly onDeadlineTarget = signal(this.data.node.on_deadline.target_node_id ?? '');

  // LLM
  private readonly llmSeed = this.nodeType === 'llm' ? (this.data.node as LlmNode) : undefined;
  readonly llmProvider = signal(this.llmSeed?.provider ?? '');
  readonly llmCredentialRef = signal(this.llmSeed?.credential_ref ?? '');
  readonly llmModel = signal(this.llmSeed?.model ?? '');
  readonly llmFallbackEnabled = signal(Boolean(this.llmSeed?.fallback));
  readonly llmFallbackProvider = signal(this.llmSeed?.fallback?.provider ?? '');
  readonly llmFallbackCredentialRef = signal(this.llmSeed?.fallback?.credential_ref ?? '');
  readonly llmFallbackModel = signal(this.llmSeed?.fallback?.model ?? '');
  readonly llmRetryMaxAttempts = signal(this.llmSeed?.retry?.max_attempts ?? 3);
  readonly llmRetryBackoffMs = signal((this.llmSeed?.retry?.backoff_ms ?? [200, 400, 800]).join(', '));
  readonly llmNextNodeId = signal(this.llmSeed?.next_node_id ?? '');

  // Tool
  private readonly toolSeed = this.nodeType === 'tool' ? (this.data.node as ToolNode) : undefined;
  readonly toolApiRef = signal(this.toolSeed?.api_ref ?? '');
  readonly toolArgumentMappingJson = signal(JSON.stringify(this.toolSeed?.argument_mapping ?? {}, null, 2));
  readonly toolArgumentMappingError = signal<string | null>(null);
  readonly toolTimeoutMs = signal<number | null>(this.toolSeed?.timeout_ms ?? null);
  readonly toolNextNodeId = signal(this.toolSeed?.next_node_id ?? '');

  // Retrieve
  private readonly retrieveSeed = this.nodeType === 'retrieve' ? (this.data.node as RetrieveNode) : undefined;
  readonly retrieveSourceRefs = signal((this.retrieveSeed?.source_refs ?? []).join(', '));
  readonly retrieveTopK = signal(this.retrieveSeed?.top_k ?? 5);
  /** The node's own overall retrieval ceiling (Phase 12b) — mirrors `RetrieveNodeSchema.budget_ms`'s schema default. */
  readonly retrieveBudgetMs = signal(this.retrieveSeed?.budget_ms ?? 400);
  readonly retrieveNextNodeId = signal(this.retrieveSeed?.next_node_id ?? '');

  // Router
  private readonly routerSeed = this.nodeType === 'router' ? (this.data.node as RouterNode) : undefined;
  readonly branches = signal<{ condition: string; next_node_id: string }[]>(
    this.routerSeed ? this.routerSeed.branches.map((b) => ({ ...b })) : [],
  );
  readonly routerDefaultNextNodeId = signal(this.routerSeed?.default_next_node_id ?? '');

  // Speak
  private readonly speakSeed = this.nodeType === 'speak' ? (this.data.node as SpeakNode) : undefined;
  readonly speakMode = signal<SpeakNode['mode']>(this.speakSeed?.mode ?? 'llm_output');
  readonly speakText = signal(this.speakSeed?.text ?? '');
  readonly speakInterruptible = signal(this.speakSeed?.interruptible ?? true);
  readonly speakNextNodeId = signal(this.speakSeed?.next_node_id ?? '');

  // Parallel (Phase 11, BL-042)
  private readonly parallelSeed = this.nodeType === 'parallel' ? (this.data.node as ParallelNode) : undefined;
  readonly parallelBranches = signal<{ id: string; entry_node_id: string; budget_ms: number | null }[]>(
    this.parallelSeed ? this.parallelSeed.branches.map((b) => ({ id: b.id, entry_node_id: b.entry_node_id, budget_ms: b.budget_ms ?? null })) : [],
  );
  readonly joinPolicy = signal<JoinPolicy>(this.parallelSeed?.join_policy ?? 'all');
  readonly quorumN = signal<number | null>(this.parallelSeed?.quorum_n ?? null);
  readonly onBranchError = signal<ParallelNode['on_branch_error']>(this.parallelSeed?.on_branch_error ?? 'continue_partial');
  readonly parallelNextNodeId = signal(this.parallelSeed?.next_node_id ?? '');

  // Loop (Phase 11, BL-043)
  private readonly loopSeed = this.nodeType === 'loop' ? (this.data.node as LoopNode) : undefined;
  readonly loopBodyEntryNodeId = signal(this.loopSeed?.body_entry_node_id ?? '');
  readonly loopCondition = signal(this.loopSeed?.condition ?? '');
  readonly loopMaxIterations = signal(this.loopSeed?.max_iterations ?? 3);
  readonly loopMaxDurationMs = signal(this.loopSeed?.max_duration_ms ?? 10000);
  readonly loopMaxCost = signal(this.loopSeed?.max_cost ?? 30);
  readonly loopNextNodeId = signal(this.loopSeed?.next_node_id ?? '');

  // Skill (Phase 13, BL-049/050/051)
  private readonly skillSeed = this.nodeType === 'skill' ? (this.data.node as SkillNode) : undefined;
  readonly skillId = signal(this.skillSeed?.skill_id ?? '');
  /** `"latest"` or a stringified version number — see the template's `<mat-select>` for why only these two shapes are offered (mirrors what `GetRuntimeConfigUseCase` can actually resolve — this tenant's currently-published version, or "always the newest"). */
  readonly skillVersion = signal(this.skillSeed ? String(this.skillSeed.version) : 'latest');
  readonly skillBudgetMs = signal(this.skillSeed?.budget_ms ?? 1500);
  readonly skillNextNodeId = signal(this.skillSeed?.next_node_id ?? '');

  // HITL (Phase 14, BL-052/053)
  private readonly hitlSeed = this.nodeType === 'hitl' ? (this.data.node as HitlNode) : undefined;
  readonly hitlGateId = signal(this.hitlSeed?.gate_id ?? '');
  readonly hitlNextNodeId = signal(this.hitlSeed?.next_node_id ?? '');

  // Sub-agent (Phase 15, BL-058)
  private readonly subagentSeed = this.nodeType === 'subagent' ? (this.data.node as SubAgentNode) : undefined;
  readonly subagentTargetTenantId = signal(this.subagentSeed?.target_tenant_id ?? '');
  readonly subagentHandbackPolicy = signal<SubAgentNode['handback_policy']>(this.subagentSeed?.handback_policy ?? 'speak_and_return');
  readonly subagentBudgetMs = signal(this.subagentSeed?.budget_ms ?? 4000);
  readonly subagentNextNodeId = signal(this.subagentSeed?.next_node_id ?? '');

  // Handoff (Phase 15, BL-059) — terminal, no next-node field (mirrors `end`).
  private readonly handoffSeed = this.nodeType === 'handoff' ? (this.data.node as HandoffNode) : undefined;
  readonly handoffDestination = signal(this.handoffSeed?.destination ?? '');
  readonly handoffContextSummary = signal(this.handoffSeed?.context_summary ?? '');

  // State (Phase 15, BL-060)
  private readonly stateSeed = this.nodeType === 'state' ? (this.data.node as StateNode) : undefined;
  readonly stateMode = signal<StateNode['mode']>(this.stateSeed?.mode ?? 'write');
  readonly stateVariable = signal(this.stateSeed?.variable ?? '');
  readonly stateValue = signal(this.stateSeed?.value ?? '');
  readonly stateNextNodeId = signal(this.stateSeed?.next_node_id ?? '');

  readonly canSave = computed(() => {
    if (this.name().trim().length === 0) {
      return false;
    }
    if (this.onErrorAction() === 'goto' && !this.onErrorTarget()) {
      return false;
    }
    if (this.onDeadlineAction() === 'goto' && !this.onDeadlineTarget()) {
      return false;
    }
    switch (this.nodeType) {
      case 'llm':
        return this.llmProvider().length > 0 && this.llmModel().trim().length > 0;
      case 'tool':
        return this.toolApiRef().trim().length > 0 && this.toolArgumentMappingError() === null;
      case 'retrieve':
        return true;
      case 'router':
        return (
          this.branches().length > 0 &&
          this.branches().every((b) => b.condition.trim().length > 0 && b.next_node_id.length > 0) &&
          this.routerDefaultNextNodeId().length > 0
        );
      case 'speak':
        return this.speakMode() === 'llm_output' || this.speakText().trim().length > 0;
      case 'end':
        return true;
      case 'parallel':
        return this.canSaveParallel();
      case 'loop':
        return (
          this.loopBodyEntryNodeId().length > 0 &&
          this.loopCondition().trim().length > 0 &&
          this.loopMaxIterations() > 0 &&
          this.loopMaxDurationMs() > 0 &&
          this.loopMaxCost() >= 0
        );
      case 'skill':
        return this.skillId().trim().length > 0 && this.skillBudgetMs() > 0;
      case 'hitl':
        return this.hitlGateId().trim().length > 0;
      case 'subagent':
        return this.subagentTargetTenantId().trim().length > 0 && this.subagentBudgetMs() > 0;
      case 'handoff':
        return this.handoffDestination().trim().length > 0;
      case 'state':
        return this.stateVariable().trim().length > 0 && (this.stateMode() === 'read' || this.stateValue().trim().length > 0);
    }
  });

  /**
   * Split out from the `canSave` switch above only because it has more than
   * one clause (branches non-empty + every entry filled in + a valid
   * `quorum_n` whenever `join_policy === 'quorum'`, mirroring the server's
   * `CONFIG_GRAPH_QUORUM_N_INVALID` semantics as fast client-side feedback).
   */
  private canSaveParallel(): boolean {
    const branches = this.parallelBranches();
    if (branches.length === 0 || !branches.every((b) => b.entry_node_id.length > 0)) {
      return false;
    }
    if (this.joinPolicy() === 'quorum' && !this.isQuorumValid()) {
      return false;
    }
    return true;
  }

  /** Whether `quorum_n` is a valid 1..branches.length value — only meaningful when `join_policy === 'quorum'`. */
  isQuorumValid(): boolean {
    const n = this.quorumN();
    return n !== null && n >= 1 && n <= this.parallelBranches().length;
  }

  credentialsFor(providerKey: string | undefined): ProviderCredentialDto[] {
    if (!providerKey) {
      return [];
    }
    return this.data.credentials.filter((c) => c.provider_key === providerKey);
  }

  hasMultipleCredentials(providerKey: string | undefined): boolean {
    return this.credentialsFor(providerKey).length > 1;
  }

  /** LLM provider catalog options — always `category: 'llm'` since this is the graph's LLM node. */
  llmDefinitions(): ProviderDefinitionDto[] {
    return this.data.definitions.filter((d) => d.category === 'llm');
  }

  optionDisabled(providerKey: string): boolean {
    const def = this.data.definitions.find((d) => d.key === providerKey);
    return (def?.requires_credential ?? true) && this.credentialsFor(providerKey).length === 0;
  }

  addBranch(): void {
    this.branches.update((b) => [...b, { condition: '', next_node_id: '' }]);
  }

  removeBranch(index: number): void {
    this.branches.update((b) => b.filter((_, i) => i !== index));
  }

  updateBranchCondition(index: number, condition: string): void {
    this.branches.update((b) => b.map((branch, i) => (i === index ? { ...branch, condition } : branch)));
  }

  updateBranchTarget(index: number, next_node_id: string): void {
    this.branches.update((b) => b.map((branch, i) => (i === index ? { ...branch, next_node_id } : branch)));
  }

  addParallelBranch(): void {
    this.parallelBranches.update((b) => [...b, { id: generateBranchId(b.map((branch) => branch.id)), entry_node_id: '', budget_ms: null }]);
  }

  removeParallelBranch(index: number): void {
    this.parallelBranches.update((b) => b.filter((_, i) => i !== index));
  }

  updateParallelBranchEntry(index: number, entry_node_id: string): void {
    this.parallelBranches.update((b) => b.map((branch, i) => (i === index ? { ...branch, entry_node_id } : branch)));
  }

  updateParallelBranchBudget(index: number, budget_ms: number | null): void {
    this.parallelBranches.update((b) => b.map((branch, i) => (i === index ? { ...branch, budget_ms } : branch)));
  }

  /** "~900 ms (estimate)" for a branch's own entry node, or an em dash while no entry is chosen yet. See `ESTIMATED_NODE_COST_MS`'s doc comment for why this is a shallow, client-side-only guess. */
  estimateBranchCostLabel(entryNodeId: string): string {
    const node = this.otherNodes.find((n) => n.id === entryNodeId);
    if (!node) {
      return '—';
    }
    const ms = ESTIMATED_NODE_COST_MS[node.type] ?? 0;
    return `~${ms} ms (estimate)`;
  }

  /** The currently-published version number for a skill, if it has one — the only concrete-number option the version `<mat-select>` offers alongside `"latest"` (mirrors what `GetRuntimeConfigUseCase` can actually resolve). */
  publishedVersionNumberFor(skillId: string): number | null {
    return this.data.skills.find((s) => s.id === skillId)?.published_version?.version_number ?? null;
  }

  onCancel(): void {
    this.dialogRef.close(undefined);
  }

  onSave(): void {
    if (!this.canSave()) {
      return;
    }
    const base = {
      id: this.data.node.id,
      name: this.name().trim(),
      lane: this.lane(),
      on_error: {
        action: this.onErrorAction(),
        target_node_id: this.onErrorAction() === 'goto' ? this.onErrorTarget() : undefined,
      },
      on_deadline: {
        action: this.onDeadlineAction(),
        target_node_id: this.onDeadlineAction() === 'goto' ? this.onDeadlineTarget() : undefined,
      },
    };

    let updated: GraphNode;
    switch (this.nodeType) {
      case 'llm':
        updated = {
          ...base,
          type: 'llm',
          provider: this.llmProvider() as LlmNode['provider'],
          credential_ref: this.llmCredentialRef() || undefined,
          model: this.llmModel().trim(),
          fallback: this.llmFallbackEnabled()
            ? {
                provider: this.llmFallbackProvider() as LlmNode['provider'],
                credential_ref: this.llmFallbackCredentialRef() || undefined,
                model: this.llmFallbackModel().trim(),
              }
            : undefined,
          retry: {
            max_attempts: this.llmRetryMaxAttempts(),
            backoff_ms: this.llmRetryBackoffMs()
              .split(',')
              .map((s) => Number(s.trim()))
              .filter((n) => !Number.isNaN(n)),
          },
          next_node_id: this.llmNextNodeId() || null,
        };
        break;
      case 'tool':
        updated = {
          ...base,
          type: 'tool',
          api_ref: this.toolApiRef().trim(),
          argument_mapping: JSON.parse(this.toolArgumentMappingJson() || '{}') as Record<string, string>,
          timeout_ms: this.toolTimeoutMs() ?? undefined,
          next_node_id: this.toolNextNodeId() || null,
        };
        break;
      case 'retrieve':
        updated = {
          ...base,
          type: 'retrieve',
          source_refs: this.retrieveSourceRefs()
            .split(',')
            .map((s) => s.trim())
            .filter((s) => s.length > 0),
          top_k: this.retrieveTopK(),
          budget_ms: this.retrieveBudgetMs(),
          next_node_id: this.retrieveNextNodeId() || null,
        };
        break;
      case 'router':
        updated = {
          ...base,
          type: 'router',
          branches: this.branches().map((b) => ({ condition: b.condition.trim(), next_node_id: b.next_node_id })),
          default_next_node_id: this.routerDefaultNextNodeId(),
        };
        break;
      case 'speak':
        updated = {
          ...base,
          type: 'speak',
          mode: this.speakMode(),
          text: this.speakMode() === 'literal' ? this.speakText().trim() : undefined,
          interruptible: this.speakInterruptible(),
          next_node_id: this.speakNextNodeId() || null,
        };
        break;
      case 'end':
        updated = { ...base, type: 'end' };
        break;
      case 'parallel':
        updated = {
          ...base,
          type: 'parallel',
          branches: this.parallelBranches().map((b) => ({
            id: b.id,
            entry_node_id: b.entry_node_id,
            budget_ms: b.budget_ms ?? undefined,
          })),
          join_policy: this.joinPolicy(),
          quorum_n: this.joinPolicy() === 'quorum' ? (this.quorumN() ?? undefined) : undefined,
          on_branch_error: this.onBranchError(),
          next_node_id: this.parallelNextNodeId() || null,
        };
        break;
      case 'loop':
        updated = {
          ...base,
          type: 'loop',
          body_entry_node_id: this.loopBodyEntryNodeId(),
          condition: this.loopCondition().trim(),
          max_iterations: this.loopMaxIterations(),
          max_duration_ms: this.loopMaxDurationMs(),
          max_cost: this.loopMaxCost(),
          next_node_id: this.loopNextNodeId() || null,
        };
        break;
      case 'skill':
        updated = {
          ...base,
          type: 'skill',
          skill_id: this.skillId(),
          version: this.skillVersion() === 'latest' ? 'latest' : Number(this.skillVersion()),
          budget_ms: this.skillBudgetMs(),
          next_node_id: this.skillNextNodeId() || null,
        };
        break;
      case 'hitl':
        updated = {
          ...base,
          type: 'hitl',
          gate_id: this.hitlGateId(),
          next_node_id: this.hitlNextNodeId() || null,
        };
        break;
      case 'subagent':
        updated = {
          ...base,
          type: 'subagent',
          target_tenant_id: this.subagentTargetTenantId(),
          handback_policy: this.subagentHandbackPolicy(),
          budget_ms: this.subagentBudgetMs(),
          next_node_id: this.subagentNextNodeId() || null,
        };
        break;
      case 'handoff':
        updated = {
          ...base,
          type: 'handoff',
          destination: this.handoffDestination().trim(),
          context_summary: this.handoffContextSummary().trim(),
        };
        break;
      case 'state':
        updated = {
          ...base,
          type: 'state',
          mode: this.stateMode(),
          variable: this.stateVariable().trim(),
          value: this.stateMode() === 'write' ? this.stateValue().trim() : undefined,
          next_node_id: this.stateNextNodeId() || null,
        };
        break;
    }

    this.dialogRef.close(updated);
  }

  onToolArgumentMappingChange(raw: string): void {
    this.toolArgumentMappingJson.set(raw);
    if (!raw.trim()) {
      this.toolArgumentMappingError.set(null);
      return;
    }
    try {
      JSON.parse(raw);
      this.toolArgumentMappingError.set(null);
    } catch {
      this.toolArgumentMappingError.set('Enter valid JSON.');
    }
  }
}
