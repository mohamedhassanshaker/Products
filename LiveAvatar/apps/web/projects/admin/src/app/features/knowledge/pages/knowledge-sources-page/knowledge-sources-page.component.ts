import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatTooltipModule } from '@angular/material/tooltip';
import { firstValueFrom } from 'rxjs';
import type { KnowledgeSourceDto, KnowledgeSourceStatus, TenantDto } from '@liveavatar/contracts';
import {
  ConfirmDialogComponent,
  EmptyStateComponent,
  PageHeaderComponent,
  StalenessBadgeComponent,
  TenantsApiService,
  formatRelativeTime,
  type AppClientError,
} from '@liveavatar/web-shared';
import { KnowledgeSourcesStore } from '../../store/knowledge-sources.store';
import {
  KnowledgeSourceDialogComponent,
  type KnowledgeSourceDialogData,
} from '../../components/knowledge-source-dialog/knowledge-source-dialog.component';

/** Ingestion status → icon/label (never colour alone, UX_GUIDELINES §1.2/§9.2). */
const KNOWLEDGE_STATUS_META: Record<KnowledgeSourceStatus, { icon: string; label: string }> = {
  pending: { icon: 'hourglass_empty', label: 'Pending' },
  processing: { icon: 'autorenew', label: 'Processing' },
  ready: { icon: 'check_circle', label: 'Ready' },
  failed: { icon: 'error', label: 'Failed' },
};

const CHUNKING_STRATEGY_LABELS: Record<string, string> = {
  fixed: 'Fixed',
  semantic: 'Semantic',
  heading_aware: 'Heading-aware',
};

/**
 * Knowledge sources tab (Phase 12a RAG ingestion,
 * `docs/plans/agent-builder-v2-plan.md`). Full CRUD table for uploaded
 * documents plus the two-step re-index preview/confirm flow: `Re-index`
 * fetches a cost/duration estimate (`GET .../reindex-estimate`, no side
 * effects) and only enqueues the real job (`POST .../reindex`) once the
 * shared `ConfirmDialogComponent` is confirmed — no existing
 * "preview-then-confirm" precedent exists elsewhere in this app (plan doc
 * "Decisions made this phase" #7). Structurally mirrors `ToolsPageComponent`.
 */
@Component({
  selector: 'la-knowledge-sources-page',
  standalone: true,
  imports: [
    RouterLink,
    PageHeaderComponent,
    EmptyStateComponent,
    StalenessBadgeComponent,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTableModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './knowledge-sources-page.component.html',
  styleUrl: './knowledge-sources-page.component.scss',
})
export class KnowledgeSourcesPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(KnowledgeSourcesStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);
  readonly displayedColumns = ['name', 'type', 'chunks', 'strategy', 'status', 'staleness', 'lastIndexed', 'actions'];

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

  statusMeta(status: KnowledgeSourceStatus) {
    return KNOWLEDGE_STATUS_META[status];
  }

  strategyLabel(strategy: string): string {
    return CHUNKING_STRATEGY_LABELS[strategy] ?? strategy;
  }

  relativeTime(iso: string | null): string {
    return iso ? formatRelativeTime(iso) : 'Never indexed';
  }

  isReindexing(source: KnowledgeSourceDto): boolean {
    return this.store.reindexingId() === source.id;
  }

  retry(): void {
    this.store.load(this.tenantId);
  }

  openCreateDialog(): void {
    const ref = this.dialog.open<KnowledgeSourceDialogComponent, KnowledgeSourceDialogData, KnowledgeSourceDto | undefined>(
      KnowledgeSourceDialogComponent,
      { width: '560px', data: {} },
    );
    ref.afterClosed().subscribe((source) => {
      if (source) {
        this.snackBar.open('Knowledge source created.', 'Dismiss', { duration: 6000 });
      }
    });
  }

  openEditDialog(source: KnowledgeSourceDto): void {
    const ref = this.dialog.open<KnowledgeSourceDialogComponent, KnowledgeSourceDialogData, KnowledgeSourceDto | undefined>(
      KnowledgeSourceDialogComponent,
      { width: '560px', data: { existing: source } },
    );
    ref.afterClosed().subscribe((updated) => {
      if (updated) {
        this.snackBar.open('Knowledge source saved.', 'Dismiss', { duration: 6000 });
      }
    });
  }

  deleteSource(source: KnowledgeSourceDto): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Delete this knowledge source?',
        body: `${source.name} and its ${source.chunk_count} indexed chunk${source.chunk_count === 1 ? '' : 's'} will be permanently removed.`,
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.store.remove(
        source.id,
        () => this.snackBar.open('Knowledge source deleted.', 'Dismiss', { duration: 6000 }),
        () => this.snackBar.open('Could not delete this knowledge source. Try again.', 'Dismiss', { duration: 6000 }),
      );
    });
  }

  /**
   * Preview-then-confirm re-index. The estimate is explicitly labelled as an
   * estimate in the confirm dialog's body (never presented as a precise
   * fact) — only a confirmed dialog result actually enqueues the job.
   */
  async reindex(source: KnowledgeSourceDto): Promise<void> {
    let estimate;
    try {
      estimate = await this.store.estimateReindex(source.id);
    } catch {
      this.snackBar.open('Could not estimate this re-index. Try again.', 'Dismiss', { duration: 6000 });
      return;
    }

    const chunkWord = estimate.chunk_count === 1 ? 'chunk' : 'chunks';
    const body =
      `This will re-chunk and re-embed an estimated ${estimate.chunk_count} ${chunkWord}. ` +
      `Estimated cost: ~$${estimate.estimated_cost_usd.toFixed(4)} · Estimated duration: ~${Math.round(estimate.estimated_duration_ms / 1000)}s. ` +
      `(Estimate only — actual cost and duration may vary.)`;

    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '480px',
      data: { title: 'Re-index this source?', body, confirmLabel: 'Re-index' },
    });
    const confirmed = await firstValueFrom(ref.afterClosed());
    if (!confirmed) {
      return;
    }

    try {
      await this.store.triggerReindex(source.id);
      this.snackBar.open('Re-index started.', 'Dismiss', { duration: 6000 });
    } catch (err) {
      const error = err as AppClientError;
      this.snackBar.open(error.message ?? 'Could not start the re-index. Try again.', 'Dismiss', { duration: 6000 });
    }
  }
}
