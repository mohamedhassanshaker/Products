import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { HitlDecisionDto, HitlGateDto, TenantDto } from '@liveavatar/contracts';
import { EmptyStateComponent, PageHeaderComponent, TenantsApiService } from '@liveavatar/web-shared';
import { ReviewerConsoleStore } from '../../store/reviewer-console.store';

/** Local 1s UI tick for the SLA countdown display — independent of the store's own 5s queue-refetch poll (no need to hammer the network just to move a progress bar). */
const CLOCK_TICK_MS = 1000;

/**
 * Reviewer console (Phase 14, BL-052..057 — `docs/v2/UX_SCOPE.md` "HITL tab
 * + Reviewer console", wireframe A8.5). Two-pane queue + detail panel,
 * following the same ≥1280px two-column/<1280px stacked-fallback rule the
 * main builder already established (§10.4 precedent, this doc's own
 * "Responsive" note). A separate top-level screen from the HITL config
 * tab — reviewers are often a different persona than the admin who
 * configures gates.
 *
 * Live audio ("🔊 listen") and caller-history enrichment are explicitly out
 * of scope (`docs/v2/UX_SCOPE.md`) — this panel renders only the fields
 * `HitlProposedActionSchema` actually carries.
 */
@Component({
  selector: 'la-reviewer-console-page',
  standalone: true,
  imports: [
    FormsModule,
    PageHeaderComponent,
    EmptyStateComponent,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './reviewer-console-page.component.html',
  styleUrl: './reviewer-console-page.component.scss',
})
export class ReviewerConsolePageComponent implements OnInit, OnDestroy {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(ReviewerConsoleStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);

  private readonly now = signal(Date.now());
  private tickHandle: ReturnType<typeof setInterval> | null = null;

  readonly justificationNote = signal('');
  readonly editedArgumentsJson = signal('');
  readonly editedArgumentsError = signal<string | null>(null);
  private editSeededForId: string | null = null;

  /** Sorted by SLA-remaining ascending (most urgent first) — wireframe A8.5's queue order. Decisions with no resolvable gate/SLA sort last. */
  readonly queue = computed(() => {
    const items = [...this.store.items()];
    items.sort((a, b) => {
      const ra = this.remainingSeconds(a);
      const rb = this.remainingSeconds(b);
      if (ra === null && rb === null) return 0;
      if (ra === null) return 1;
      if (rb === null) return -1;
      return ra - rb;
    });
    return items;
  });

  readonly selected = computed(() => this.store.items().find((d) => d.id === this.store.selectedId()) ?? null);

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
    this.tickHandle = setInterval(() => this.now.set(Date.now()), CLOCK_TICK_MS);
  }

  ngOnDestroy(): void {
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
    }
  }

  gateFor(decision: HitlDecisionDto): HitlGateDto | undefined {
    return this.store.gates().find((g) => g.id === decision.gate_id);
  }

  elapsedSeconds(decision: HitlDecisionDto): number {
    return Math.max(0, Math.floor((this.now() - Date.parse(decision.created_at)) / 1000));
  }

  /** `null` when the gate can't be resolved (e.g. deleted after the decision was created) — never a misleading fixed number. */
  slaSeconds(decision: HitlDecisionDto): number | null {
    return this.gateFor(decision)?.sla_seconds ?? null;
  }

  remainingSeconds(decision: HitlDecisionDto): number | null {
    const sla = this.slaSeconds(decision);
    if (sla === null) {
      return null;
    }
    return Math.max(0, sla - this.elapsedSeconds(decision));
  }

  progressPercent(decision: HitlDecisionDto): number {
    const sla = this.slaSeconds(decision);
    if (!sla) {
      return 0;
    }
    return Math.min(100, (this.elapsedSeconds(decision) / sla) * 100);
  }

  select(decision: HitlDecisionDto): void {
    this.store.select(decision.id);
    this.justificationNote.set('');
    this.seedEditedArguments(decision);
  }

  private seedEditedArguments(decision: HitlDecisionDto): void {
    if (this.editSeededForId === decision.id) {
      return;
    }
    this.editSeededForId = decision.id;
    this.editedArgumentsJson.set(JSON.stringify(decision.proposed_action.arguments ?? {}, null, 2));
    this.editedArgumentsError.set(null);
  }

  onEditedArgumentsChange(raw: string): void {
    this.editedArgumentsJson.set(raw);
    try {
      JSON.parse(raw || '{}');
      this.editedArgumentsError.set(null);
    } catch {
      this.editedArgumentsError.set('Enter valid JSON.');
    }
  }

  approve(): void {
    const decision = this.selected();
    if (!decision) {
      return;
    }
    this.store.decide(
      decision.id,
      { action: 'approve', justification_note: this.justificationNote().trim() || undefined },
      () => this.snackBar.open('Approved.', 'Dismiss', { duration: 6000 }),
      () => this.snackBar.open('Could not record this decision. Try again.', 'Dismiss', { duration: 6000 }),
    );
  }

  deny(): void {
    const decision = this.selected();
    if (!decision) {
      return;
    }
    this.store.decide(
      decision.id,
      { action: 'deny', justification_note: this.justificationNote().trim() || undefined },
      () => this.snackBar.open('Denied.', 'Dismiss', { duration: 6000 }),
      () => this.snackBar.open('Could not record this decision. Try again.', 'Dismiss', { duration: 6000 }),
    );
  }

  editAndApprove(): void {
    const decision = this.selected();
    if (!decision || this.editedArgumentsError()) {
      return;
    }
    let edited_arguments: Record<string, unknown>;
    try {
      edited_arguments = JSON.parse(this.editedArgumentsJson() || '{}') as Record<string, unknown>;
    } catch {
      this.editedArgumentsError.set('Enter valid JSON.');
      return;
    }
    this.store.decide(
      decision.id,
      { action: 'edit_approve', edited_arguments, justification_note: this.justificationNote().trim() || undefined },
      () => this.snackBar.open('Approved with edits.', 'Dismiss', { duration: 6000 }),
      () => this.snackBar.open('Could not record this decision. Try again.', 'Dismiss', { duration: 6000 }),
    );
  }

  retry(): void {
    this.store.load(this.tenantId);
  }
}
