import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import type { HitlGateDto, TenantDto } from '@liveavatar/contracts';
import { ConfirmDialogComponent, EmptyStateComponent, PageHeaderComponent, TenantsApiService } from '@liveavatar/web-shared';
import { HitlGatesStore } from '../../store/hitl-gates.store';
import { GateDialogComponent, type GateDialogData } from '../../components/gate-dialog/gate-dialog.component';

/**
 * HITL tab (Phase 14, BL-052..057 — `docs/v2/UX_SCOPE.md` "HITL tab +
 * Reviewer console", wireframe A8.4). Table of active gates (trigger, type,
 * reviewers, SLA, status) + "+ Add gate" dialog. Follows exactly the
 * structure `features/tools/pages/tools-page/` established for the same
 * "own route, pre-Phase-16-shell, own store" shape.
 *
 * The 7-day hit/approval-rate columns from the wireframe are omitted this
 * phase — no metrics endpoint exists yet (R-H10 is a separate, not-yet-built
 * capability; this page only covers the config CRUD side, R-H1..R-H3).
 */
@Component({
  selector: 'la-hitl-gates-page',
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
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './hitl-gates-page.component.html',
  styleUrl: './hitl-gates-page.component.scss',
})
export class HitlGatesPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(HitlGatesStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);
  readonly displayedColumns = ['attachment', 'type', 'reviewers', 'sla', 'status', 'actions'];

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

  reviewerGroupName(gate: HitlGateDto): string {
    return this.store.reviewerGroups().find((g) => g.id === gate.reviewer_group_id)?.name ?? '(unknown group)';
  }

  openCreateDialog(): void {
    const ref = this.dialog.open<GateDialogComponent, GateDialogData, HitlGateDto | undefined>(GateDialogComponent, {
      width: '640px',
      maxHeight: '90vh',
      data: { reviewerGroups: this.store.reviewerGroups() },
    });
    ref.afterClosed().subscribe((gate) => {
      if (gate) {
        this.snackBar.open('Gate created.', 'Dismiss', { duration: 6000 });
      }
    });
  }

  openEditDialog(gate: HitlGateDto): void {
    const ref = this.dialog.open<GateDialogComponent, GateDialogData, HitlGateDto | undefined>(GateDialogComponent, {
      width: '640px',
      maxHeight: '90vh',
      data: { existing: gate, reviewerGroups: this.store.reviewerGroups() },
    });
    ref.afterClosed().subscribe((updated) => {
      if (updated) {
        this.snackBar.open('Gate saved.', 'Dismiss', { duration: 6000 });
      }
    });
  }

  deleteGate(gate: HitlGateDto): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Delete this gate?',
        body: `${gate.attachment_ref} will no longer require human approval.`,
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.store.remove(
        gate.id,
        () => this.snackBar.open('Gate deleted.', 'Dismiss', { duration: 6000 }),
        () => this.snackBar.open('Could not delete this gate. Try again.', 'Dismiss', { duration: 6000 }),
      );
    });
  }

  goToReviewerGroups(): void {
    void this.router.navigate(['/tenants', this.tenantId, 'hitl', 'reviewer-groups']);
  }

  retry(): void {
    this.store.load(this.tenantId);
  }
}
