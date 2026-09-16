/** B13 tab 1's "Edit cases" — remove a case. Soft delete; `TR_GoldenCases_recount` drops
 *  `GoldenSet.caseCount` in the same statement. */

import type { GoldenCaseRepository } from "../ports/golden-set-repository.js";

export class RemoveGoldenCase {
  constructor(private readonly deps: { readonly cases: GoldenCaseRepository }) {}

  async execute(goldenCaseId: string, now: Date): Promise<void> {
    await this.deps.cases.remove(goldenCaseId, now);
  }
}
