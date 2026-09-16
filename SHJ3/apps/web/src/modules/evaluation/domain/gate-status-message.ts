/**
 * B13 tab 3's live consequence strip — pure text composition, zero I/O. Deliberately
 * knows nothing about HOW an agent's display name or version label is resolved (that is
 * a cross-module lookup — `agents/ports/agent-repository.ts` — which this module may not
 * import per `eslint.config.mjs`'s "no sibling feature" boundary rule): the caller (an
 * `app`-classified composition point, which is allowed to import every feature) resolves
 * the name/label and hands them in already-resolved, exactly the same "structural
 * composition, not a cross-feature import" pattern `agents/ports/publish-gate-checker.ts`
 * uses for the opposite direction of this same B-9 wiring.
 *
 * Renders the EXACT wireframe copy (B13 tab 3): *"Gate is active. **General FAQ Agent
 * v3.0** is currently blocked — Arabic parity at 71% is below the 85% floor."* and, when
 * off, *"Any agent can be published regardless of test results."*
 */

import type { GateBlockingReason } from "./gate-evaluation.js";

export interface BlockedVersionDisplay {
  readonly agentName: string;
  readonly versionLabel: string;
  readonly reasons: readonly GateBlockingReason[];
}

function formatReason(reason: GateBlockingReason): string {
  switch (reason.metric) {
    case "accuracy":
      return `${reason.goldenSetName ?? "accuracy"} at ${Math.round(reason.observed * 100)}% is below the ${Math.round(reason.threshold * 100)}% floor`;
    case "groundedness":
      return `${reason.goldenSetName ?? "groundedness"} groundedness at ${Math.round(reason.observed * 100)}% is below the ${Math.round(reason.threshold * 100)}% floor`;
    case "toolAccuracy":
      return `${reason.goldenSetName ?? "tool accuracy"} at ${Math.round(reason.observed * 100)}% is below the ${Math.round(reason.threshold * 100)}% floor`;
    case "localeParity":
      return `${reason.goldenSetName ?? "language parity"} at ${Math.round(reason.observed * 100)}% is below the ${Math.round(reason.threshold * 100)}% floor`;
    case "redTeam":
      return `${reason.goldenSetName ?? "the guardrail red-team set"} scored ${Math.round(reason.observed * 100)}%, below the required 100%`;
    case "boundLocale":
      return `${reason.localeCode ?? "a bound locale"} parity at ${Math.round(reason.observed)}% is below the ${Math.round(reason.threshold)}% floor`;
    case "suiteFailure":
      return "no regression run exists yet for this version";
  }
}

/** The gate is OFF — FR-EVAL-10's own required sentence. */
export function gateInactiveMessage(): string {
  return "Any agent can be published regardless of test results.";
}

/** The gate is ON and nothing is currently blocked. */
export function gateActiveNoBlockMessage(): string {
  return "Gate is active. Every agent version currently meets its publish requirements.";
}

/** The gate is ON and names the one real, currently-blocked version. */
export function gateActiveBlockedMessage(blocked: BlockedVersionDisplay): string {
  const [firstReason] = blocked.reasons;
  const reasonText = firstReason
    ? formatReason(firstReason)
    : "one or more requirements are not met";
  return `Gate is active. ${blocked.agentName} ${blocked.versionLabel} is currently blocked — ${reasonText}.`;
}
