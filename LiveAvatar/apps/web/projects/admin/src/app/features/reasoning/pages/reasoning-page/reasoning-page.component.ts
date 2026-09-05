import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { ConfigErrorDto, GraphNode, TenantDto, TestCallNodeResultDto, TestCallResponseDto } from '@liveavatar/contracts';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  PageHeaderComponent,
  TenantsApiService,
  TestCallPanelComponent,
  utf8ByteLength,
} from '@liveavatar/web-shared';
import { ReasoningStore } from '../../store/reasoning.store';
import { NODE_TYPES, type NodeType } from '../../store/node-factory';
import { NodeCardComponent } from '../../components/node-card/node-card.component';
import { NodeInspectorComponent, type NodeInspectorData } from '../../components/node-inspector/node-inspector.component';
import { TurnBudgetPanelComponent } from '../../components/turn-budget-panel/turn-budget-panel.component';

/** FR-CONFIG-2: `agent.system_prompt`'s limit, in UTF-8 bytes (matches `AgentConfigSchema.agent.system_prompt`'s `maxLength: 32768`, re-checked in bytes server-side — see `utf8ByteLength`'s doc comment). */
const SYSTEM_PROMPT_BYTE_LIMIT = 32768;

/**
 * Reasoning tab (Phase 9, BL-035/036/037 — `docs/v2/UX_SCOPE.md` "Reasoning
 * tab"). Node-card list (`role="list"`/`listitem"`), "Add node ▾" menu,
 * inspector dialog, and the shared test-call harness, following exactly the
 * structure `features/tools/pages/tools-page/` established in Phase 8 for
 * the same "own route, pre-Phase-16-shell, own store" shape.
 *
 * Phase 16 (BL-063) adds a "Core instructions" section above the graph
 * editor: `agent.system_prompt` (textarea + live UTF-8 byte counter,
 * mirroring the old `agent-builder-page`'s exact `promptByteLength()`
 * logic), `agent.runtime`, and `agent.memory` — see `docs/v2/UX_SCOPE.md`'s
 * resolved ambiguity for why these fields, which have no named tab in any
 * source doc, landed here rather than on a media-pipeline or dynamics tab.
 */
@Component({
  selector: 'la-reasoning-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    EmptyStateComponent,
    NodeCardComponent,
    TestCallPanelComponent,
    TurnBudgetPanelComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatMenuModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reasoning-page.component.html',
  styleUrl: './reasoning-page.component.scss',
})
export class ReasoningPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(ReasoningStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);
  readonly nodeTypes = NODE_TYPES;

  /** Most recent test-call result, fed by the embedded harness — drives each node card's last-test-status badge. */
  readonly testCallResult = signal<TestCallResponseDto | null>(null);

  // Empty-state (R-G1: config.reasoning entirely absent — brand-new tenant, no LLM chosen yet).
  readonly emptyStateProvider = signal('');
  readonly emptyStateModel = signal('');

  readonly llmDefinitions = computed(() => this.store.definitions().filter((d) => d.category === 'llm'));

  /** Core instructions section (Phase 16, BL-063). */
  readonly promptByteLength = computed(() => utf8ByteLength(this.store.agent().system_prompt ?? ''));
  readonly promptByteLimit = SYSTEM_PROMPT_BYTE_LIMIT;
  readonly promptOverLimit = computed(() => this.promptByteLength() > SYSTEM_PROMPT_BYTE_LIMIT);

  ngOnInit(): void {
    if (!this.tenantId) {
      void this.router.navigate(['/deployments']);
      return;
    }
    this.tenantsApi.get(this.tenantId).subscribe({
      next: (tenant) => this.tenant.set(tenant),
      error: () => undefined,
    });
    this.store.load(this.tenantId);
  }

  testResultFor(nodeId: string): TestCallNodeResultDto | undefined {
    return this.testCallResult()?.nodes.find((n) => n.node_id === nodeId);
  }

  errorsFor(nodeId: string): ConfigErrorDto[] {
    return this.store.errorsByNode().get(nodeId) ?? [];
  }

  /** Core instructions section's inline errors (e.g. `CONFIG_PROMPT_TOO_LARGE` at layer `agent.system_prompt`) — same per-layer lookup `agent-builder.store.ts`'s Pipeline tab already uses. */
  errorsForLayer(layer: string): string[] {
    return (this.store.errorsByLayer().get(layer) ?? []).map((e) => e.message);
  }

  onRuntime(runtime: string): void {
    this.store.setRuntime(runtime);
  }

  onSystemPrompt(system_prompt: string): void {
    this.store.setSystemPrompt(system_prompt);
  }

  onMemoryEnabled(enabled: boolean): void {
    this.store.setMemoryEnabled(enabled);
  }

  onMemoryWindow(window_turns: number): void {
    this.store.setMemoryWindowTurns(window_turns);
  }

  createDefaultGraph(): void {
    if (!this.emptyStateProvider() || !this.emptyStateModel().trim()) {
      return;
    }
    this.store.initializeDefaultGraph({ provider: this.emptyStateProvider(), model: this.emptyStateModel().trim() });
  }

  addNode(type: NodeType): void {
    const id = this.store.addNode(type);
    if (id) {
      this.openInspector(id);
    }
  }

  openInspector(nodeId: string): void {
    const reasoning = this.store.reasoning();
    const node = reasoning?.graph.find((n) => n.id === nodeId);
    if (!reasoning || !node) {
      return;
    }
    const data: NodeInspectorData = {
      node,
      otherNodes: reasoning.graph.filter((n) => n.id !== nodeId),
      definitions: this.store.definitions(),
      credentials: this.store.credentials(),
      tools: this.store.tools(),
      skills: this.store.skills(),
      gates: this.store.gates(),
      tenants: this.store.tenants(),
    };
    const ref = this.dialog.open<NodeInspectorComponent, NodeInspectorData, GraphNode | undefined>(NodeInspectorComponent, {
      width: '640px',
      maxHeight: '90vh',
      data,
    });
    ref.afterClosed().subscribe((updated) => {
      if (updated) {
        this.store.updateNode(nodeId, updated);
      }
    });
  }

  deleteNode(node: GraphNode): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Delete this node?',
        body: `${node.name} will be removed from the graph. Any edge still pointing at it will fail validation until you repoint it.`,
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.store.removeNode(node.id);
      }
    });
  }

  saveDraft(): void {
    this.store.saveDraft(() => this.snackBar.open('Draft saved.', 'Dismiss', { duration: 6000 }));
  }

  publish(): void {
    this.store.publish(() => this.snackBar.open('Configuration published.', 'Dismiss', { duration: 6000 }));
  }

  reload(): void {
    if (this.store.dirty()) {
      const ref = this.dialog.open(ConfirmDialogComponent, {
        width: '440px',
        data: {
          title: 'Discard your unsaved changes and reload the latest configuration?',
          confirmLabel: 'Discard and reload',
          body: 'Any edits you have not saved will be lost.',
        },
      });
      ref.afterClosed().subscribe((confirmed) => {
        if (confirmed) {
          this.store.reloadAfterConflict();
        }
      });
      return;
    }
    this.store.reloadAfterConflict();
  }

  retry(): void {
    this.store.load(this.tenantId);
  }
}
