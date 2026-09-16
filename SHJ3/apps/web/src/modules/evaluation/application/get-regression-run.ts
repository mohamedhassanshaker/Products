/** A regression run's own detail — the run plus its per-case results (the failure list
 *  B13 tab 2's drill-down needs to name which case failed and why). */

import type {
  RegressionCaseResultRow,
  RegressionRunRepository,
  RegressionRunRow,
} from "../ports/regression-run-repository.js";

export interface RegressionRunDetail {
  readonly run: RegressionRunRow;
  readonly caseResults: readonly RegressionCaseResultRow[];
}

export class GetRegressionRun {
  constructor(private readonly deps: { readonly runs: RegressionRunRepository }) {}

  async execute(regressionRunId: string): Promise<RegressionRunDetail | null> {
    const run = await this.deps.runs.findById(regressionRunId);
    if (!run) return null;
    const caseResults = await this.deps.runs.listCaseResults(regressionRunId);
    return { run, caseResults };
  }
}
