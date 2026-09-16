/** B13 tab 1's "Edit cases" detail — the set plus its cases (FR-EVAL-04, a SHOULD, kept
 *  as a simple list rather than a richer editor). */

import type {
  GoldenCaseRepository,
  GoldenCaseRow,
  GoldenSetRepository,
  GoldenSetRow,
} from "../ports/golden-set-repository.js";

export interface GoldenSetDetail {
  readonly set: GoldenSetRow;
  readonly cases: readonly GoldenCaseRow[];
}

export class GetGoldenSet {
  constructor(
    private readonly deps: {
      readonly sets: GoldenSetRepository;
      readonly cases: GoldenCaseRepository;
    },
  ) {}

  async execute(goldenSetId: string): Promise<GoldenSetDetail | null> {
    const set = await this.deps.sets.findById(goldenSetId);
    if (!set) return null;
    const cases = await this.deps.cases.listForSet(goldenSetId);
    return { set, cases };
  }
}
