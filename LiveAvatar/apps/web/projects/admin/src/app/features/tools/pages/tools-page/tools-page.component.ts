import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { TenantDto, ToolDto } from '@liveavatar/contracts';
import { ConfirmDialogComponent, EmptyStateComponent, PageHeaderComponent, TenantsApiService } from '@liveavatar/web-shared';
import { ToolsStore } from '../../store/tools.store';
import { ToolDialogComponent, type ToolDialogData } from '../../components/tool-dialog/tool-dialog.component';

/** R-T2: warn above this many agent-level "always available" tools (default 8). */
const ALWAYS_AVAILABLE_WARN_COUNT = 8;

/**
 * Tools tab (BL-033/034, `docs/v2/UX_SCOPE.md`). Full CRUD registry table
 * plus the agent-level "always available" attach panel and its base-prompt
 * token-cost banner. Attach/detach reuses the existing
 * `PUT /tenants/:id/config` draft-save flow (`agent.tools[]`) via
 * `ToolsStore.toggleAttach` — not a new endpoint (see
 * `docs/plans/agent-builder-v2-plan.md` Phase 8). `ToolsStore` owns that
 * round-trip locally rather than this component importing
 * `AgentBuilderStore`: the admin SPA's ESLint feature-isolation zones
 * (`eslint.config.mjs` `webFeatures`) forbid one feature reaching into
 * another feature's store.
 */
@Component({
  selector: 'la-tools-page',
  standalone: true,
  imports: [
    RouterLink,
    PageHeaderComponent,
    EmptyStateComponent,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tools-page.component.html',
  styleUrl: './tools-page.component.scss',
})
export class ToolsPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(ToolsStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);
  readonly displayedColumns = ['name', 'endpoint', 'lane', 'consequential', 'attached', 'actions'];

  readonly attachedTools = computed(() => {
    const refs = this.store.attachedRefs();
    return this.store.items().filter((t) => refs.has(t.api_ref));
  });

  /**
   * Rough base-prompt token estimate for attached tools (~4 UTF-8 bytes per
   * token, the same order-of-magnitude heuristic used for English text —
   * not a real tokenizer call, since none is available in the admin SPA).
   */
  readonly attachedTokenEstimate = computed(() =>
    this.attachedTools().reduce((sum, tool) => {
      const text = tool.name + (tool.description ?? '') + JSON.stringify(tool.args_schema ?? {});
      return sum + Math.ceil(new TextEncoder().encode(text).length / 4);
    }, 0),
  );

  readonly attachedOverLimit = computed(() => this.attachedTools().length > ALWAYS_AVAILABLE_WARN_COUNT);
  readonly attachedLimit = ALWAYS_AVAILABLE_WARN_COUNT;

  readonly consequentialTools = computed(() => this.store.items().filter((t) => t.consequential));

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

  isAttached(tool: ToolDto): boolean {
    return this.store.attachedRefs().has(tool.api_ref);
  }

  toggleAttach(tool: ToolDto): void {
    this.store.toggleAttach(
      tool,
      (attached) => this.snackBar.open(`${tool.name} ${attached ? 'attached' : 'detached'}.`, 'Dismiss', { duration: 6000 }),
      () => this.snackBar.open('Could not update this tool. Try again.', 'Dismiss', { duration: 6000 }),
    );
  }

  openCreateDialog(): void {
    const ref = this.dialog.open<ToolDialogComponent, ToolDialogData, ToolDto | undefined>(ToolDialogComponent, {
      width: '560px',
      data: {},
    });
    ref.afterClosed().subscribe((tool) => {
      if (tool) {
        this.snackBar.open('Tool created.', 'Dismiss', { duration: 6000 });
      }
    });
  }

  openEditDialog(tool: ToolDto): void {
    const ref = this.dialog.open<ToolDialogComponent, ToolDialogData, ToolDto | undefined>(ToolDialogComponent, {
      width: '560px',
      data: { existing: tool },
    });
    ref.afterClosed().subscribe((updated) => {
      if (updated) {
        this.snackBar.open('Tool saved.', 'Dismiss', { duration: 6000 });
      }
    });
  }

  deleteTool(tool: ToolDto): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Delete this tool?',
        body: `${tool.name} will no longer be reachable by this agent.`,
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.store.remove(
        tool.id,
        () => this.snackBar.open('Tool deleted.', 'Dismiss', { duration: 6000 }),
        () => this.snackBar.open('Could not delete this tool. Try again.', 'Dismiss', { duration: 6000 }),
      );
    });
  }

  testTool(tool: ToolDto): void {
    this.store.testInvoke(tool.id, {});
  }

  testResultFor(tool: ToolDto) {
    return this.store.testResults()[tool.id];
  }

  isTesting(tool: ToolDto): boolean {
    return this.store.testingId() === tool.id;
  }

  retry(): void {
    this.store.load(this.tenantId);
  }
}
