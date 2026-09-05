import { ChangeDetectionStrategy, Component, OnInit, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BudgetBarComponent, ConfirmDialogComponent, PageHeaderComponent, YamlViewerComponent } from '@liveavatar/web-shared';
import { AgentBuilderStore } from '../../store/agent-builder.store';
// Phase 16 exemption — see `overview-tab.component.ts`'s doc comment; the
// shell needs `ReasoningStore` for the persistent right rail's turn-budget
// bar (`UX_SCOPE.md`'s "right-rail always shows current turn-budget/cost/
// validation state regardless of which tab is active"), and needs all five
// of these to trigger their loads once on mount — see this class's own doc
// comment for why that responsibility lives here, not in `OverviewTabComponent`.
import { ReasoningStore } from '../../../reasoning/store/reasoning.store';
import { ToolsStore } from '../../../tools/store/tools.store';
import { SkillsLibraryStore } from '../../../skills/store/skills-library.store';
import { KnowledgeSourcesStore } from '../../../knowledge/store/knowledge-sources.store';
import { HitlGatesStore } from '../../../hitl/store/hitl-gates.store';
import { estimateTokens } from '../../token-estimate.util';

/** Canonical tab order (`docs/v2/UX_SCOPE.md`'s IA line: "Tab order matches A9.1's table: Overview, Pipeline, Reasoning, Skills, Tools, Knowledge, Dynamics, HITL, Privacy"). */
const TABS: { label: string; path: string }[] = [
  { label: 'Overview', path: 'overview' },
  { label: 'Pipeline', path: 'pipeline' },
  { label: 'Reasoning', path: 'reasoning' },
  { label: 'Skills', path: 'skills' },
  { label: 'Tools', path: 'tools' },
  { label: 'Knowledge', path: 'knowledge' },
  { label: 'Dynamics', path: 'dynamics' },
  { label: 'HITL', path: 'hitl' },
  { label: 'Privacy', path: 'privacy' },
];

/**
 * Agent Builder shell (Phase 16, BL-065 — the final item of the v2 roadmap).
 * Replaces the old single-page `agent-builder-page` and every standalone
 * tab route (Tools/Reasoning/Knowledge/Skills/HITL/Residency) with one
 * `mat-tab-group` + persistent right rail, per A9.2's two-column wireframe.
 * A routing/composition change, not new feature work, for 6 of its 9 tabs
 * (`UX_SCOPE.md`'s own framing) — this component's job is only the shell
 * chrome and the tab strip; every tab's actual content is either an
 * existing feature's page component mounted at a nested route (see
 * `agent-builder.routes.ts`) or one of this phase's three new tab
 * components (Overview/Pipeline+Dynamics/Privacy-via-Residency).
 *
 * The tab strip is `mat-tab-group` bound to the *router*, not to
 * `mat-tab`'s own content projection: each `<mat-tab>` below is
 * label-only, and the actual content renders through the `<router-outlet>`
 * beneath it, driven by `agent-builder.routes.ts`'s child routes. This is
 * what makes every tab independently linkable (deep links, browser back)
 * while still getting `mat-tab-group`'s built-in APG tab semantics (arrow
 * -key navigation, `role` wiring) for free, per `UX_SCOPE.md`'s
 * accessibility note.
 *
 * Owns the one `AgentBuilderStore` load for this "builder session" (Pipeline
 * and Dynamics tabs share this store but never call `.load()` themselves —
 * see `PipelineTabComponent`'s doc comment for why), plus a guarded load of
 * the five other tabs' stores so the right rail has real data even on a
 * deep link straight into e.g. Dynamics that never mounts `OverviewTabComponent`.
 * This component itself is never destroyed by a tab switch (Angular only
 * swaps the child `<router-outlet>` content when only the child route
 * segment changes), which is *why* the right rail persists across tab
 * switches without any extra code — see `UX_SCOPE.md`'s explicit
 * "don't recompute per tab" requirement.
 */
@Component({
  selector: 'la-builder-shell',
  standalone: true,
  imports: [
    RouterLink,
    RouterOutlet,
    PageHeaderComponent,
    YamlViewerComponent,
    BudgetBarComponent,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatTabsModule,
    MatTooltipModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './builder-shell.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', '../builder-shared.scss'],
})
export class BuilderShellComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly store = inject(AgentBuilderStore);
  private readonly reasoningStore = inject(ReasoningStore);
  private readonly toolsStore = inject(ToolsStore);
  private readonly skillsStore = inject(SkillsLibraryStore);
  private readonly knowledgeStore = inject(KnowledgeSourcesStore);
  private readonly hitlStore = inject(HitlGatesStore);

  readonly tenantId = this.route.snapshot.paramMap.get('id') ?? '';
  readonly tabs = TABS;

  private readonly activeChildSegment = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.firstChildPathSegment()),
    ),
    { initialValue: this.firstChildPathSegment() },
  );

  readonly activeTabIndex = computed(() => {
    const index = TABS.findIndex((t) => t.path === this.activeChildSegment());
    return index === -1 ? 0 : index;
  });

  /** Right rail — turn budget (reuses `ReasoningStore`'s already-computed critical path, same data the Reasoning tab's own turn-budget panel renders). */
  readonly turnBudgetMs = computed(() => this.reasoningStore.reasoning()?.turn_budget_ms ?? 0);
  readonly criticalPathMs = computed(() => this.reasoningStore.criticalPath()?.critical_path_ms ?? 0);

  /** Right rail — rough base-prompt token split (no server-side breakdown exists; see `overview-tab.component.ts`'s doc comment). */
  readonly coreTokenEstimate = computed(() => estimateTokens(this.reasoningStore.agent().system_prompt ?? ''));
  readonly toolsTokenEstimate = computed(() => {
    const refs = this.toolsStore.attachedRefs();
    return this.toolsStore
      .items()
      .filter((t) => refs.has(t.api_ref))
      .reduce((sum, t) => sum + estimateTokens(t.name + (t.description ?? '')), 0);
  });
  readonly skillsTokenEstimate = computed(() =>
    this.skillsStore.items().reduce((sum, skill) => {
      const version = skill.published_version ?? skill.draft_version;
      return sum + estimateTokens(skill.name + (version?.description ?? ''));
    }, 0),
  );
  readonly basePromptTokenEstimate = computed(
    () => this.coreTokenEstimate() + this.toolsTokenEstimate() + this.skillsTokenEstimate(),
  );

  /** Right rail — validation summary. One call already validates the whole document (transport/stt/tts/avatar/dynamics *and* reasoning/skills/knowledge/hitl), so this is a single aggregate, not a sum across tabs — see this class's doc comment. */
  readonly validationErrorCount = computed(
    () => (this.store.validateResult()?.errors ?? []).filter((e) => e.severity !== 'warning').length,
  );
  readonly validationWarningCount = computed(
    () => (this.store.validateResult()?.errors ?? []).filter((e) => e.severity === 'warning').length,
  );

  ngOnInit(): void {
    if (!this.tenantId) {
      void this.router.navigate(['/deployments']);
      return;
    }
    this.store.load(this.tenantId);
    this.loadIfNeeded(this.reasoningStore, () => this.reasoningStore.load(this.tenantId));
    this.loadIfNeeded(this.toolsStore, () => this.toolsStore.load(this.tenantId));
    this.loadIfNeeded(this.skillsStore, () => this.skillsStore.load(this.tenantId));
    this.loadIfNeeded(this.knowledgeStore, () => this.knowledgeStore.load(this.tenantId));
    this.loadIfNeeded(this.hitlStore, () => this.hitlStore.load(this.tenantId));
  }

  onTabIndexChange(index: number): void {
    const tab = TABS[index];
    if (tab) {
      void this.router.navigate([tab.path], { relativeTo: this.route });
    }
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

  private firstChildPathSegment(): string {
    return this.route.snapshot.firstChild?.url[0]?.path ?? 'overview';
  }

  /**
   * Loads a tab's store only if it isn't already holding this tenant's data
   * — a deep link into the shell must not clobber state from a tab visited
   * moments ago in the same session (same guard `OverviewTabComponent`
   * would otherwise have needed; centralized here instead).
   * @param store - Any of the five root-singleton stores above
   * @param load - That store's own bound `load` call
   */
  private loadIfNeeded(store: { tenantId: () => string | null }, load: () => void): void {
    if (store.tenantId() !== this.tenantId) {
      load();
    }
  }
}
