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
import type { SkillDto, SkillVersionDto, TenantDto } from '@liveavatar/contracts';
import { ConfirmDialogComponent, EmptyStateComponent, PageHeaderComponent, TenantsApiService } from '@liveavatar/web-shared';
import { SkillsLibraryStore } from '../../store/skills-library.store';
import { NewSkillDialogComponent } from '../../components/new-skill-dialog/new-skill-dialog.component';

/**
 * Skills library (Skills tab, Phase 13, BL-049/050/051 — `docs/v2/UX_SCOPE.md`
 * "Skills tab", wireframe §A5.4). Full CRUD registry table, following exactly
 * the structure `features/tools/pages/tools-page/` established for the same
 * "own route, pre-Phase-16-shell, own store" shape. **No platform-library
 * section** (BL-074 — explicitly out of scope this phase, "since there's
 * genuinely nothing behind it yet"; the wireframe's "PLATFORM LIBRARY" block
 * is deliberately omitted, not shown disabled).
 */
@Component({
  selector: 'la-skills-library-page',
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
  templateUrl: './skills-library-page.component.html',
  styleUrl: './skills-library-page.component.scss',
})
export class SkillsLibraryPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly tenantsApi = inject(TenantsApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  readonly store = inject(SkillsLibraryStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tenant = signal<TenantDto | null>(null);
  readonly displayedColumns = ['name', 'version', 'tools', 'knowledge', 'hitl', 'budget', 'used_by', 'actions'];

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

  /** The version whose content "counts" for this row's table columns — the mutable draft if one exists, else the immutable published snapshot (mirrors the Skill editor's own `seedDraft` precedence). */
  currentVersion(skill: SkillDto): SkillVersionDto | null {
    return skill.draft_version ?? skill.published_version;
  }

  toolsCount(skill: SkillDto): number {
    return this.currentVersion(skill)?.tools.length ?? 0;
  }

  sourceRefsCount(skill: SkillDto): number {
    return this.currentVersion(skill)?.knowledge_filters.source_refs.length ?? 0;
  }

  budgetMs(skill: SkillDto): number | null {
    return this.currentVersion(skill)?.budget_ms ?? null;
  }

  /**
   * Phase 14 follow-up (BL-052, R-S6) — whether this skill has a HITL gate
   * attached. A plain boolean indicator rather than resolving the gate's
   * name: this list page has no reason to fetch the tenant's gate registry
   * otherwise, and the task's own v1 fallback ("a plain boolean indicator
   * is fine") avoids adding that fetch just for a table tooltip — the real
   * gate detail is one click away in the Skill editor.
   */
  hasHitlGate(skill: SkillDto): boolean {
    return Boolean(this.currentVersion(skill)?.hitl_gate_id);
  }

  openCreateDialog(): void {
    const ref = this.dialog.open<NewSkillDialogComponent, undefined, SkillDto | undefined>(NewSkillDialogComponent, {
      width: '480px',
    });
    ref.afterClosed().subscribe((skill) => {
      if (skill) {
        // Per UX_SCOPE.md: "'+ New skill' opens the editor" — the dialog is
        // just the minimal name-capture step before landing on the real
        // editor, not a place to configure the rest of the skill.
        void this.router.navigate(['tenants', this.tenantId, 'skills', skill.id]);
      }
    });
  }

  deleteSkill(skill: SkillDto): void {
    const ref = this.dialog.open(ConfirmDialogComponent, {
      width: '460px',
      data: {
        title: 'Delete this skill?',
        body: `${skill.name} will no longer be reachable by any agent.`,
        confirmLabel: 'Delete',
        destructive: true,
      },
    });
    ref.afterClosed().subscribe((confirmed) => {
      if (!confirmed) {
        return;
      }
      this.store.remove(
        skill.id,
        () => this.snackBar.open('Skill deleted.', 'Dismiss', { duration: 6000 }),
        () => this.snackBar.open('Could not delete this skill. Try again.', 'Dismiss', { duration: 6000 }),
      );
    });
  }

  retry(): void {
    this.store.load(this.tenantId);
  }
}
