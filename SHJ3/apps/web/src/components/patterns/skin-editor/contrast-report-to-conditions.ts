/**
 * Maps a `ContrastReport` (the REAL gate from `@shj3/tokens`/`appearance-gate.ts` —
 * never reimplemented here) onto `SummaryStrip`'s `blocking` variant shape
 * (design-system.md §10.2, §9.2 rule 2): "render the failing pairs via SummaryStrip's
 * blocking variant... the Save button is disabled with the failure list wired via
 * aria-describedby."
 *
 * **No suggested nearest-passing value.** §10.2's prose describes one ("a suggested
 * nearest-passing value computed by walking the foreground's lightness in OKLCH until
 * the ratio clears"), but neither `checkContrast`'s real `ContrastCheck` shape nor
 * `appearance-gate.ts` computes or carries one today (checked directly — `ContrastCheck`
 * has `pair`/`foreground`/`background`/`ratio`/`required`/`passed`/`blocking` and
 * nothing else). The brief is explicit: use one if it already exists, do not invent a
 * second contrast-fixing algorithm if it does not. It does not, so this module reports
 * the failing pair, the measured ratio and the required ratio — everything the real
 * gate actually computes — and stops there. A `suggestedForeground` column is a real,
 * named, out-of-scope gap for a future wave (see `tasks/todo.md`'s review entry).
 */

import type { ContrastReport } from "@shj3/tokens";
import type { BlockingCondition } from "@/components/ui/summary-strip";

/** One report's blockers, labelled with which mode they came from — `light`/`dark`
 *  reports are gated independently (§9.2 rule 6: both modes are edited and validated
 *  independently) so a combined failure list must still say which mode each pair
 *  belongs to, or "fix the failing pair" has no way to know which editing tab to open. */
export function contrastReportToConditions(
  report: ContrastReport,
  modeLabel: string,
): BlockingCondition[] {
  return report.blockers.map((check) => ({
    blocked: check.pair.note,
    measured: `${check.ratio.toFixed(2)}:1`,
    threshold: `${check.required}:1`,
    source: `${check.pair.fg} / ${check.pair.bg} — ${modeLabel}`,
  }));
}

/** Combines the light and dark reports' failing pairs into one non-empty tuple for a
 *  single `SummaryStrip`, or `null` when both modes pass — the caller renders nothing
 *  (or a passing state) rather than an empty strip when this returns `null`. */
export function combineContrastFailures(
  lightReport: ContrastReport | null,
  darkReport: ContrastReport | null,
  labels: { readonly light: string; readonly dark: string },
): [BlockingCondition, ...BlockingCondition[]] | null {
  const conditions: BlockingCondition[] = [
    ...(lightReport ? contrastReportToConditions(lightReport, labels.light) : []),
    ...(darkReport ? contrastReportToConditions(darkReport, labels.dark) : []),
  ];
  if (conditions.length === 0) return null;
  return conditions as [BlockingCondition, ...BlockingCondition[]];
}
