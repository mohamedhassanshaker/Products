/**
 * B13 tab 3's five settings, saved — and audited on every single change (FR-EVAL-13:
 * "every change to the publish gate configuration" is one of the three events this
 * module must produce an audit entry for; the other two — a gate-blocked publish attempt,
 * and a publish permitted with the gate disabled — are `EvaluateGateForVersion`'s own job,
 * not this one's).
 *
 * Reuses the platform's own real `AuditSink` port (`modules/platform/ports/
 * provisioning.ts`) rather than declaring a second, near-duplicate audit contract in this
 * module — `platform` is the substrate every feature module may depend on
 * (`eslint.config.mjs`'s boundary rule), and a second audit port here would just be the
 * same five fields under a different name for no real benefit.
 */

import type { Principal } from "../../platform/tenancy/tenant-context.js";
import type { AuditSink } from "../../platform/ports/provisioning.js";
import type { PublishGateRepository, PublishGateRow } from "../ports/publish-gate-repository.js";

export interface UpdatePublishGateInput {
  readonly principal: Principal;
  readonly blockOnSuiteFailure: boolean;
  readonly minAccuracy: number;
  readonly minGroundedness: number;
  readonly redTeamMustScore100: boolean;
  readonly blockOnBoundLocaleBelow100: boolean;
  readonly now: Date;
}

/** FR-EVAL-10: "shall state that consequence on the configuration surface" — the exact
 *  sentence the UI renders when the master switch is off, computed here so the wording
 *  lives in one place rather than being re-typed by the screen. */
export function gateDisabledConsequenceText(): string {
  return "Any agent can be published regardless of test results.";
}

export class UpdatePublishGate {
  constructor(
    private readonly deps: { readonly gate: PublishGateRepository; readonly audit: AuditSink },
  ) {}

  async execute(input: UpdatePublishGateInput): Promise<PublishGateRow> {
    const before = await this.deps.gate.getOrCreateDefault(input.principal.id, input.now);
    const after = await this.deps.gate.update({
      blockOnSuiteFailure: input.blockOnSuiteFailure,
      minAccuracy: input.minAccuracy,
      minGroundedness: input.minGroundedness,
      redTeamMustScore100: input.redTeamMustScore100,
      blockOnBoundLocaleBelow100: input.blockOnBoundLocaleBelow100,
      updatedByStaffUserId: input.principal.id,
      now: input.now,
    });

    const summary = after.blockOnSuiteFailure
      ? "Updated the publish gate configuration."
      : `Updated the publish gate configuration. ${gateDisabledConsequenceText()}`;

    await this.deps.audit.record({
      actor: { kind: "Principal", principal: input.principal },
      action: "evaluation.publish_gate_updated",
      target: { kind: "PublishGate", id: before.id, labelSnapshot: "Publish gate" },
      summary,
      before: {
        blockOnSuiteFailure: before.blockOnSuiteFailure,
        minAccuracy: before.minAccuracy,
        minGroundedness: before.minGroundedness,
        redTeamMustScore100: before.redTeamMustScore100,
        blockOnBoundLocaleBelow100: before.blockOnBoundLocaleBelow100,
      },
      after: {
        blockOnSuiteFailure: after.blockOnSuiteFailure,
        minAccuracy: after.minAccuracy,
        minGroundedness: after.minGroundedness,
        redTeamMustScore100: after.redTeamMustScore100,
        blockOnBoundLocaleBelow100: after.blockOnBoundLocaleBelow100,
      },
    });

    return after;
  }
}
