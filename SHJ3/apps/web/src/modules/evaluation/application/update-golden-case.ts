/** B13 tab 1's "Edit cases" — amend a case's prompt/expected outcome, or enable/disable it. */

import type {
  GoldenCaseRepository,
  GoldenCaseRow,
  UpdateGoldenCaseInput,
} from "../ports/golden-set-repository.js";

export class UpdateGoldenCase {
  constructor(private readonly deps: { readonly cases: GoldenCaseRepository }) {}

  async execute(goldenCaseId: string, patch: UpdateGoldenCaseInput): Promise<GoldenCaseRow> {
    return this.deps.cases.update(goldenCaseId, patch);
  }
}
