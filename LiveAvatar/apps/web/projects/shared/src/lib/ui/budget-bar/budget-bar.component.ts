import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Visual tone derived from `usedMs / totalMs` — never colour alone (UX_GUIDELINES §1.2), see the template's text label. */
export type BudgetBarTone = 'success' | 'caution' | 'error';

/**
 * Shared budget-bar component (Phase 10, `UX_SCOPE.md`'s explicit
 * "build it once in Phase 10" instruction) — a small, purely presentational
 * `used / total` bar. Used by the Reasoning tab's turn-budget panel
 * (`used_ms` = a path's `total_ms`, `total_ms` = `turn_budget_ms`) today,
 * and reusable verbatim by Phase 12b's retrieval-pipeline budget total
 * (`used_ms` = the summed stage budgets, `total_ms` = the retrieval
 * budget) — no feature-specific naming or logic here.
 *
 * Tone is derived purely from the ratio (not a caller-supplied
 * `over_budget` flag) so any caller with a `used`/`total` pair of numbers
 * can reuse this without first computing its own threshold logic:
 * `> 100%` is `error`, `>= 80%` is `caution` (matches the wireframe's own
 * amber/red distinction — a path already over budget vs. one closing in on
 * it), otherwise `success`.
 */
@Component({
  selector: 'la-budget-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './budget-bar.component.html',
  styleUrl: './budget-bar.component.scss',
})
export class BudgetBarComponent {
  readonly usedMs = input.required<number>();
  readonly totalMs = input.required<number>();
  /** Shown alongside the bar, e.g. a path's node sequence or a pipeline stage name. Optional — the bar is meaningful on its own. */
  readonly label = input<string>('');

  readonly ratio = computed(() => (this.totalMs() > 0 ? this.usedMs() / this.totalMs() : 0));
  readonly percent = computed(() => Math.round(this.ratio() * 100));
  readonly fillPercent = computed(() => Math.min(100, Math.max(0, this.percent())));
  readonly tone = computed<BudgetBarTone>(() => {
    const ratio = this.ratio();
    if (ratio > 1) {
      return 'error';
    }
    if (ratio >= 0.8) {
      return 'caution';
    }
    return 'success';
  });
  readonly statusText = computed(() => {
    const percent = this.percent();
    if (this.tone() === 'error') {
      return `${percent}% — over budget by ${this.usedMs() - this.totalMs()}ms`;
    }
    return `${percent}% of budget`;
  });
}
