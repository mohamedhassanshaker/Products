export type TraceStepStatus = "success" | "warning" | "error" | "pending";

/** One step in a trace/orchestration/grounding listing (design-system.md §5.5 #47). */
export interface TraceStep {
  id: string;
  /** Mono primary line, e.g. `"router → billing_agent (confidence 0.94)"` — the caller composes this; this component does not build sentences from parts (§11.3 rule 4). */
  primaryLine: string;
  /** 0–1. Rendered as text, e.g. `"confidence 0.94"` — never a bar (§5.5 #47's own explicit rule). */
  confidence?: number;
  durationMs?: number;
  status?: TraceStepStatus;
  /** JSON (or other) payload shown via the real `CodeBlock` when this step is expanded. */
  payload?: string;
  /** `--chart-1…4` (§5.5 #47's token list) — a `var()` reference, applied via `style`. */
  chartToken?: string;
  /** `variant="orchestration"` only — steps sharing a group render clustered, conveying fan-out/fan-in structure (B4's parallel and supervisor–worker modes). */
  parallelGroup?: string;
}

export type DiffLineKind = "added" | "removed" | "unchanged";

/** One line of a version diff (B2). */
export interface DiffLine {
  id: string;
  kind: DiffLineKind;
  text: string;
}

/**
 * Groups consecutive steps sharing the same defined `parallelGroup` into
 * clusters, in original order — the one function both the live render and
 * `diff-trace-viewer.test.tsx`'s grouping test call, so the two cannot
 * silently disagree about which steps are clustered together. A step with no
 * `parallelGroup` is its own single-step group.
 */
export interface TraceStepGroup {
  key: string;
  parallelGroup: string | undefined;
  steps: readonly TraceStep[];
}

export function groupTraceSteps(steps: readonly TraceStep[]): readonly TraceStepGroup[] {
  const groups: { key: string; parallelGroup: string | undefined; steps: TraceStep[] }[] = [];

  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && step.parallelGroup !== undefined && last.parallelGroup === step.parallelGroup) {
      last.steps.push(step);
      continue;
    }
    groups.push({ key: step.id, parallelGroup: step.parallelGroup, steps: [step] });
  }

  return groups;
}
