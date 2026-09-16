/** B13 tab 1's table: Set / Cases / Owner / Last score. */

import type { GoldenSetRepository, GoldenSetRow } from "../ports/golden-set-repository.js";

export class ListGoldenSets {
  constructor(private readonly deps: { readonly sets: GoldenSetRepository }) {}

  async execute(): Promise<readonly GoldenSetRow[]> {
    return this.deps.sets.list();
  }
}
