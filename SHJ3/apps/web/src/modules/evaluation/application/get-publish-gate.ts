/** B13 tab 3's five settings, read for display. */

import type { PublishGateRepository, PublishGateRow } from "../ports/publish-gate-repository.js";

export class GetPublishGate {
  constructor(private readonly deps: { readonly gate: PublishGateRepository }) {}

  async execute(seedStaffUserId: string, now: Date): Promise<PublishGateRow> {
    return this.deps.gate.getOrCreateDefault(seedStaffUserId, now);
  }
}
