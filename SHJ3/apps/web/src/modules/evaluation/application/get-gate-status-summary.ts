/**
 * B13 tab 3's live consequence strip — the DATA half. Returns which real agent version
 * (if any) is currently blocked and why; the caller (an `app`-classified composition
 * point) resolves that version's display name/label via `agents/ports/agent-repository.ts`
 * and renders the final sentence with `domain/gate-status-message.ts` — this module may
 * not import `agents` directly (`eslint.config.mjs`'s "no sibling feature" rule), so the
 * cross-module name lookup belongs one layer up, same as `agents/ports/publish-gate-
 * checker.ts`'s own doc comment describes for the opposite direction of this wiring.
 */

import type { GateBlockingReason } from "../ports/publish-gate-checker.js";
import type { GateEvaluationRepository } from "../ports/gate-evaluation-repository.js";
import type { PublishGateRepository } from "../ports/publish-gate-repository.js";

export interface GateStatusSummary {
  readonly gateActive: boolean;
  readonly blockedVersion: {
    readonly agentVersionId: string;
    readonly reasons: readonly GateBlockingReason[];
  } | null;
}

export class GetGateStatusSummary {
  constructor(
    private readonly deps: {
      readonly gate: PublishGateRepository;
      readonly evaluations: GateEvaluationRepository;
    },
  ) {}

  async execute(seedStaffUserId: string, now: Date): Promise<GateStatusSummary> {
    const gate = await this.deps.gate.getOrCreateDefault(seedStaffUserId, now);
    const gateActive =
      gate.blockOnSuiteFailure || gate.redTeamMustScore100 || gate.blockOnBoundLocaleBelow100;
    if (!gateActive) return { gateActive: false, blockedVersion: null };

    const blocked = await this.deps.evaluations.findMostRecentlyBlockedPublish();
    if (!blocked || blocked.blockingReasonsJson === null) {
      return { gateActive: true, blockedVersion: null };
    }

    const reasons = JSON.parse(blocked.blockingReasonsJson) as readonly GateBlockingReason[];
    return {
      gateActive: true,
      blockedVersion: { agentVersionId: blocked.agentVersionId, reasons },
    };
  }
}
