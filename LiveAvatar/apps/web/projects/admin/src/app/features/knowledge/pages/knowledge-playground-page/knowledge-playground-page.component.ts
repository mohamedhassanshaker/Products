import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import type { RunRetrievalPlaygroundResponseDto, TenantDto } from '@liveavatar/contracts';
import {
  BudgetBarComponent,
  KnowledgeSourcesApiService,
  PageHeaderComponent,
  TenantsApiService,
  type AppClientError,
} from '@liveavatar/web-shared';

/**
 * Knowledge tab's Playground sub-tab (Phase 12b, BL-045/047/048; spec §A7.5,
 * UC-R1). Query + optional conversation-context input, a "Run" button, and
 * a stage-by-stage result table — visually/structurally patterned after
 * `TestCallPanelComponent` (query input, Run button, `aria-live="polite"`
 * coalesced summary) but **not** built on top of it: per the plan doc's
 * Phase 12b "Decisions made this phase" #8, this calls a dedicated
 * retrieval-only endpoint (`POST /tenants/:id/knowledge/playground/run`)
 * that runs the real six-stage pipeline against the tenant's live index —
 * real vector/BM25 scores, a real rewrite, a real filter/threshold outcome —
 * which `TestCallResponseDto`'s generic per-node summary shape cannot carry.
 * Never writes a `KnowledgeGap` row (an admin's own diagnostic query, not a
 * real caller's turn) and never re-announces the full candidate/injected
 * table on the `aria-live` region — only the coalesced summary (§10.7).
 */
@Component({
  selector: 'la-knowledge-playground-page',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    PageHeaderComponent,
    BudgetBarComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatTableModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './knowledge-playground-page.component.html',
  styleUrl: './knowledge-playground-page.component.scss',
})
export class KnowledgePlaygroundPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly knowledgeApi = inject(KnowledgeSourcesApiService);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);

  readonly query = signal('');
  readonly conversationContext = signal('');
  readonly running = signal(false);
  readonly result = signal<RunRetrievalPlaygroundResponseDto | null>(null);
  readonly error = signal<AppClientError | null>(null);

  readonly candidateColumns = ['source', 'excerpt', 'vector', 'keyword', 'blend'];

  ngOnInit(): void {
    if (!this.tenantId) {
      void this.router.navigate(['/deployments']);
      return;
    }
    this.tenantsApi.get(this.tenantId).subscribe({
      next: (tenant) => this.tenant.set(tenant),
      error: () => undefined,
    });
  }

  runDisabled(): boolean {
    return this.running() || this.query().trim().length === 0;
  }

  run(): void {
    if (this.runDisabled()) {
      return;
    }
    this.running.set(true);
    this.error.set(null);
    this.result.set(null);

    const context = this.conversationContext().trim();
    this.knowledgeApi
      .runRetrievalPlayground(this.tenantId, {
        query: this.query().trim(),
        ...(context.length > 0 ? { conversation_context: context } : {}),
      })
      .subscribe({
        next: (response) => {
          this.running.set(false);
          this.result.set(response);
        },
        error: (err: AppClientError) => {
          this.running.set(false);
          this.error.set(err);
        },
      });
  }

  /** Summary-only text for the `aria-live="polite"` region — never re-announces the full stage tables (§10.7 precedent), UX_SCOPE.md's exact shape. */
  runSummary(): string {
    const r = this.result();
    if (!r) {
      return '';
    }
    const n = r.inject.chunks.length;
    return `${n} chunk${n === 1 ? '' : 's'} injected, ${r.total_ms}ms`;
  }

  formatScore(score: number): string {
    return score.toFixed(2);
  }
}
