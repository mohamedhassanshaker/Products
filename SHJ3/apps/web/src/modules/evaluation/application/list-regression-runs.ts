/** B13 tab 2's table: Agent/Version/Set/Accuracy/Groundedness/Tool accuracy/Result — newest first. */

import type {
  RegressionRunRepository,
  RegressionRunRow,
} from "../ports/regression-run-repository.js";

export class ListRegressionRuns {
  constructor(private readonly deps: { readonly runs: RegressionRunRepository }) {}

  async execute(limit?: number): Promise<readonly RegressionRunRow[]> {
    return this.deps.runs.listRecent(limit);
  }
}
