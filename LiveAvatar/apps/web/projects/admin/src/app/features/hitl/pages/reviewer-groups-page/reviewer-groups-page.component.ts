import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import type { ReviewerGroupDto, TenantDto } from '@liveavatar/contracts';
import { ConfirmDialogComponent, EmptyStateComponent, PageHeaderComponent, TenantsApiService } from '@liveavatar/web-shared';
import { ReviewerGroupsStore } from '../../store/reviewer-groups.store';
import { ReviewerGroupDialogComponent, type ReviewerGroupDialogData } from '../../components/reviewer-group-dialog/reviewer-group-dialog.component';

/**
 * Reviewer group management page (HITL tab, Phase 14, BL-052..057 —
 * `docs/v2/UX_SCOPE.md` "HITL tab + Reviewer console"). Full CRUD registry
 * table, following exactly the structure `features/tools/pages/tools-page/`
 * established for the same "own route, own store" shape.
 */
@Component({
  selector: 'la-reviewer-groups-page',
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
  templateUrl: './reviewer-groups-page.component.html',
  styleUrl: './reviewer-groups-page.component.scss',
})
export class ReviewerGroupsPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(ReviewerGroupsStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);
  readonly displayedColumns = ['name', 'members', 'channels', 'actions'];

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

  openCreateDialog(): void {
    const ref = this.dialog.open<ReviewerGroupDialogComponent, ReviewerGroupDialogData, ReviewerGroupDto | undefined>(
      ReviewerGroupDialogComponent,
      { width: '560px', data: {} },
    );
    ref.afterClosed().subscribe((group) => {
      if (group) {
        this.snackBar.open('Reviewer group created.', 'Dismiss', { duration: 6000 });
      }
    });
  }

  openEditDialog(group: ReviewerGroupDto): void {
    const ref = this.dialog.open<ReviewerGroupDialogComponent, ReviewerGroupDialogData, ReviewerGroupDto | undefined>(
      ReviewerGroupDialogComponent,
      { width: '560px', data: { existing: group } },
    );
    ref.afterClosed().subscribe((updated) => {
      if (updated) {
        this.snackBar.open('Reviewer group saved.', 'Dismiss', { duration: 6000 });
      }
    });
  }

  deleteGroup(group: ReviewerGroupDto): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Delete this reviewer group?',
        body: `${group.name} will no longer be assignable to a gate.`,
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.store.remove(
        group.id,
        () => this.snackBar.open('Reviewer group deleted.', 'Dismiss', { duration: 6000 }),
        () => this.snackBar.open('Could not delete this reviewer group. Try again.', 'Dismiss', { duration: 6000 }),
      );
    });
  }

  retry(): void {
    this.store.load(this.tenantId);
  }
}
