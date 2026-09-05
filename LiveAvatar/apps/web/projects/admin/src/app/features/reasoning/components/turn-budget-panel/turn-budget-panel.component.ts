import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { CriticalPathGraphPathDto, CriticalPathReportDto, Reasoning } from '@liveavatar/contracts';
import { BudgetBarComponent } from '@liveavatar/web-shared';

/** One deferred "OPTIMISATIONS" checklist item (§A4.3) — shown disabled-with-reason, never hidden or silently enabled. */
interface OptimisationItem {
  label: string;
  savesHint: string;
  reason: string;
}

const DEFERRED_OPTIMISATIONS: OptimisationItem[] = [
  {
    label: 'Speculative retrieval on partial transcript',
    savesHint: 'saves ~200-400ms',
    reason: 'Coming in a later phase (BL-067) — needs partial-transcript hooks not built yet.',
  },
  {
    label: 'Pre-synthesise Speak nodes at publish',
    savesHint: 'saves time-to-first-audio',
    reason: 'Coming in a later phase (BL-068) — needs a TTS pre-synthesis cache not built yet.',
  },
  {
    label: 'Cache retrieval results',
    savesHint: '',
    reason: 'Coming in a later phase, alongside real RAG retrieval (Phase 12b) — Retrieve is still a stub.',
  },
];

/**
 * Turn budget panel (Phase 10, BL-040/041 — §A4.3's wireframe content,
 * inline in the Reasoning tab per `UX_SCOPE.md`'s Phase-10-extension
 * decision, not a separate route/dialog). Renders the critical-path
 * timeline and all-paths list from `/config/validate`'s `critical_path`
 * data, a read-only "when the hard deadline is hit" summary (editing it
 * reuses the entry node's own inspector — `NodeInspectorComponent` already
 * exposes `on_deadline` per node, so this panel doesn't duplicate that
 * editing surface, just surfaces it and links to it), and the deferred
 * OPTIMISATIONS checklist rendered disabled-with-reason
 * (`UX_GUIDELINES.md` §10.5's established pattern, reused — never hidden,
 * never silently enabled).
 *
 * Does **not** fabricate an endpointing/TTS-first-audio breakdown (see the
 * plan doc's "Speak/TTS double-counting avoided" decision) — neither exists
 * in this schema yet (Dynamics is Phase 16), so the timeline shows only the
 * graph's own critical-path nodes against `turn_budget_ms`, exactly what
 * V-1/R-G3 validates.
 */
@Component({
  selector: 'la-turn-budget-panel',
  standalone: true,
  imports: [BudgetBarComponent, MatButtonModule, MatCheckboxModule, MatIconModule, MatTooltipModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './turn-budget-panel.component.html',
  styleUrls: ['../../../../shared/dialog-shared.scss', './turn-budget-panel.component.scss'],
})
export class TurnBudgetPanelComponent {
  readonly reasoning = input.required<Reasoning>();
  readonly criticalPath = input<CriticalPathReportDto | null>(null);

  readonly openNode = output<string>();

  readonly deferredOptimisations = DEFERRED_OPTIMISATIONS;

  readonly criticalPathLabel = computed(() => this.pathLabel(this.longestPath()));

  /**
   * The path this panel highlights as "the" critical path. Phase 14 (R-H4):
   * an unbounded path (one passing through a `hitl` node) always wins over
   * any bounded one, however large — its true cost genuinely cannot be
   * estimated, which is a stronger fact than any finite `total_ms` number,
   * mirroring `critical-path.ts`'s own "unbounded rather than estimated"
   * rule on the server side.
   */
  readonly longestPath = computed<CriticalPathGraphPathDto | null>(() => {
    const report = this.criticalPath();
    if (!report || report.paths.length === 0) {
      return null;
    }
    const unbounded = report.paths.find((p) => p.unbounded);
    if (unbounded) {
      return unbounded;
    }
    return report.paths.reduce((longest, p) => (p.total_ms > longest.total_ms ? p : longest), report.paths[0]);
  });

  readonly overBudgetPathCount = computed(() => this.criticalPath()?.paths.filter((p) => p.over_budget).length ?? 0);

  /** Phase 14 (R-H4) — at least one enumerated path passes through a HITL node and is never counted toward the turn budget. */
  readonly hasUnboundedPath = computed(() => this.criticalPath()?.has_unbounded_path ?? false);

  readonly entryNode = computed(() => this.reasoning().graph.find((n) => n.id === this.reasoning().entry_node_id));

  readonly entryNodeOnDeadlineTargetName = computed(() => {
    const entry = this.entryNode();
    if (!entry || entry.on_deadline.action !== 'goto' || !entry.on_deadline.target_node_id) {
      return null;
    }
    return this.reasoning().graph.find((n) => n.id === entry.on_deadline.target_node_id)?.name ?? entry.on_deadline.target_node_id;
  });

  pathLabel(path: CriticalPathGraphPathDto | null): string {
    if (!path) {
      return '';
    }
    return path.steps.map((s) => s.name).join(' → ');
  }

  editEntryNode(): void {
    const entry = this.entryNode();
    if (entry) {
      this.openNode.emit(entry.id);
    }
  }
}
