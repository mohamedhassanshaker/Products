import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type {
  CitationFormat,
  MetadataFilterCondition,
  RetrievalPipelineConfig,
  TenantDto,
} from '@liveavatar/contracts';
import { BudgetBarComponent, EmptyStateComponent, PageHeaderComponent, TenantsApiService } from '@liveavatar/web-shared';
import { KnowledgePipelineStore } from '../../store/knowledge-pipeline.store';

/** `^[a-zA-Z0-9_]+$` — mirrors `MetadataFilterConditionSchema.field`'s backend pattern (`packages/contracts`), checked client-side before the round trip. */
const METADATA_FIELD_PATTERN = /^[a-zA-Z0-9_]+$/;

const CITATION_FORMATS: readonly { value: CitationFormat; label: string }[] = [
  { value: 'numbered', label: 'Numbered with source citations' },
  { value: 'inline', label: 'Inline' },
  { value: 'none', label: 'None' },
];

const METADATA_OPS: readonly { value: MetadataFilterCondition['op']; label: string }[] = [
  { value: 'eq', label: '=' },
  { value: 'neq', label: '≠' },
  { value: 'contains', label: 'contains' },
];

/**
 * Knowledge tab's Pipeline sub-tab (Phase 12b, BL-045/047; spec §A7.4). The
 * six-stage retrieval form — rewrite, hybrid search (always on), metadata
 * filter, rerank (disabled-with-reason, BL-070), threshold, inject — each
 * with its own `<la-budget-bar>` slice, plus a running-total bar against the
 * resolved overall retrieval budget. Structurally mirrors the Reasoning
 * tab's own "edit a slice of the whole draft config directly via
 * `[ngModel]`/`(ngModelChange)`, no local FormGroup" pattern
 * (`reasoning-page.component.ts`/the Pipeline tab's `pipeline-tab.component.ts`,
 * `agent-builder-page.component.ts` before Phase 16's builder shell) rather
 * than `KnowledgeSourceDialogComponent`'s reactive-forms pattern — this tab
 * has no local submit-time draft or per-field async server-error mapping
 * (V-9/V-10 surface once, inline at the running-total line, not per field),
 * and the store's `draftConfig` signal is already the one source of truth,
 * so a second, parallel `FormGroup` copy of the same data would only add a
 * two-way-sync problem this codebase's own closest precedents don't have.
 */
@Component({
  selector: 'la-knowledge-pipeline-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    EmptyStateComponent,
    BudgetBarComponent,
    MatButtonModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatSlideToggleModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './knowledge-pipeline-page.component.html',
  styleUrl: './knowledge-pipeline-page.component.scss',
})
export class KnowledgePipelinePageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(KnowledgePipelineStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);

  readonly citationFormats = CITATION_FORMATS;
  readonly metadataOps = METADATA_OPS;

  /** Sum of every real stage's `budget_ms` — everything except Rerank, which has none (a deferred no-op, never invoked, R-R3). */
  readonly stageTotalMs = computed(() => {
    const p = this.store.pipeline();
    if (!p) {
      return 0;
    }
    return p.rewrite.budget_ms + p.hybrid_search.budget_ms + p.metadata_filter.budget_ms + p.threshold.budget_ms + p.inject.budget_ms;
  });

  /**
   * Denominator for every stage bar and the running-total bar. The Retrieve
   * node's own `budget_ms` when one exists in the graph (this phase's one
   * real ceiling — see the store's doc comment); when no Retrieve node
   * exists yet, falls back to the summed stage total itself so the bar shows
   * a stable 100%-of-itself instead of a misleading `0/0`.
   */
  readonly effectiveBudgetMs = computed(() => this.store.retrieveNodeBudgetMs() ?? this.stageTotalMs());

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

  /** One edit primitive for every stage — merges `patch` into the stage's current value and pushes it to the store. */
  patchStage<K extends keyof RetrievalPipelineConfig>(stage: K, patch: Partial<RetrievalPipelineConfig[K]>): void {
    const current = this.store.pipeline()?.[stage];
    if (!current) {
      return;
    }
    this.store.updateStage(stage, { ...current, ...patch });
  }

  patchMetadataCondition(patch: Partial<MetadataFilterCondition>): void {
    const stage = this.store.pipeline()?.metadata_filter;
    if (!stage) {
      return;
    }
    const condition: MetadataFilterCondition = { field: '', op: 'eq', value: '', ...stage.condition, ...patch };
    this.store.updateStage('metadata_filter', { ...stage, condition });
  }

  metadataFieldInvalid(): boolean {
    const field = this.store.pipeline()?.metadata_filter.condition?.field ?? '';
    return field.length > 0 && !METADATA_FIELD_PATTERN.test(field);
  }

  saveDraft(): void {
    this.store.saveDraft(() => this.snackBar.open('Draft saved.', 'Dismiss', { duration: 6000 }));
  }

  publish(): void {
    this.store.publish(() => this.snackBar.open('Configuration published.', 'Dismiss', { duration: 6000 }));
  }

  reload(): void {
    this.store.reloadAfterConflict();
  }

  retry(): void {
    this.store.load(this.tenantId);
  }
}
