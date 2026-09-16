"use server";

/**
 * Server Actions for `/evaluation` (B13: Evaluation & testing) — every write on this
 * screen.
 *
 * `evaluation:manage` gates every action here (the real, seeded permission the
 * orchestrating session already added to `iam/domain/permissions.ts`, granted to
 * `SuperAdmin`/`EntityAdmin`) — checked here, in the caller, per api.md §12 invariant 2,
 * matching `escalations/actions.ts`'s identical convention: the use cases in
 * `modules/evaluation/application` do not check permissions themselves.
 */

import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { AddCaseFromTranscript } from "../../../../modules/evaluation/application/add-case-from-transcript.js";
import { AddGoldenCase } from "../../../../modules/evaluation/application/add-golden-case.js";
import { CreateGoldenSet } from "../../../../modules/evaluation/application/create-golden-set.js";
import { GetGateStatusSummary } from "../../../../modules/evaluation/application/get-gate-status-summary.js";
import { GetGoldenSet } from "../../../../modules/evaluation/application/get-golden-set.js";
import { GetPublishGate } from "../../../../modules/evaluation/application/get-publish-gate.js";
import { GetRegressionRun } from "../../../../modules/evaluation/application/get-regression-run.js";
import { ListGoldenSets } from "../../../../modules/evaluation/application/list-golden-sets.js";
import { ListRegressionRuns } from "../../../../modules/evaluation/application/list-regression-runs.js";
import { RemoveGoldenCase } from "../../../../modules/evaluation/application/remove-golden-case.js";
import {
  RunAllSuites,
  type RunAllSuitesOutcome,
  type SuitePairing,
} from "../../../../modules/evaluation/application/run-all-suites.js";
import { RunGoldenSetNow } from "../../../../modules/evaluation/application/run-golden-set-now.js";
import { UpdateGoldenCase } from "../../../../modules/evaluation/application/update-golden-case.js";
import { UpdatePublishGate } from "../../../../modules/evaluation/application/update-publish-gate.js";
import type { GoldenSetKind } from "../../../../modules/evaluation/domain/vocabulary.js";
import type {
  GoldenCaseRow,
  GoldenSetRow,
} from "../../../../modules/evaluation/ports/golden-set-repository.js";
import type { PublishGateRow } from "../../../../modules/evaluation/ports/publish-gate-repository.js";
import type { RegressionRunRow } from "../../../../modules/evaluation/ports/regression-run-repository.js";
import {
  agentRepository,
  aiEvaluationClient,
  auditSink,
  evaluationConversationFactory,
  gateEvaluationRepository,
  goldenCaseRepository,
  goldenSetRepository,
  now,
  publishGateRepository,
  regressionRunRepository,
} from "./composition.js";

const PERMISSION = "evaluation:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Tab 1 — Golden sets
// ---------------------------------------------------------------------------

export async function listGoldenSetsAction(): Promise<ActionResult<readonly GoldenSetRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "evaluation.listGoldenSets");
      const value = await new ListGoldenSets({ sets: goldenSetRepository() }).execute();
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function getGoldenSetAction(
  goldenSetId: string,
): Promise<
  ActionResult<{ readonly set: GoldenSetRow; readonly cases: readonly GoldenCaseRow[] } | null>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "evaluation.getGoldenSet");
      const value = await new GetGoldenSet({
        sets: goldenSetRepository(),
        cases: goldenCaseRepository(),
      }).execute(goldenSetId);
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function createGoldenSetAction(input: {
  readonly name: string;
  readonly ownerTenantId: string;
  readonly description: string | null;
  readonly kind: GoldenSetKind;
  readonly localeCode: string | null;
}): Promise<ActionResult<GoldenSetRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "evaluation.createGoldenSet");
        const result = await new CreateGoldenSet({ sets: goldenSetRepository() }).execute({
          ...input,
          now: now(),
        });
        if (!result.ok) return { ok: false, error: result.error } as const;
        return { ok: true, value: result.value } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function addGoldenCaseAction(input: {
  readonly goldenSetId: string;
  readonly prompt: string;
  readonly expectedBehaviour: string;
  readonly mustRefuse: boolean;
  readonly localeCode: string;
}): Promise<ActionResult<GoldenCaseRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "evaluation.addGoldenCase");
        const value = await new AddGoldenCase({ cases: goldenCaseRepository() }).execute({
          ...input,
          expectedToolCallsJson: null,
          addedByStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** B1's own "Add to golden set" button, reachable from this screen too for a transcript
 *  a staff member already has the id of. */
export async function addCaseFromTranscriptAction(input: {
  readonly goldenSetId: string;
  readonly sourceConversationId: string;
  readonly prompt: string;
  readonly expectedBehaviour: string;
  readonly mustRefuse: boolean;
  readonly localeCode: string;
}): Promise<ActionResult<{ readonly caseId: string; readonly caseCount: number }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "evaluation.addCaseFromTranscript");
        const result = await new AddCaseFromTranscript({
          cases: goldenCaseRepository(),
          sets: goldenSetRepository(),
        }).execute({ ...input, addedByStaffUserId: principal.id, now: now() });
        if (!result.ok) return { ok: false, error: result.error } as const;
        return { ok: true, value: result.value } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updateGoldenCaseAction(
  goldenCaseId: string,
  patch: {
    readonly prompt?: string;
    readonly expectedBehaviour?: string;
    readonly mustRefuse?: boolean;
    readonly localeCode?: string;
    readonly isEnabled?: boolean;
  },
): Promise<ActionResult<GoldenCaseRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "evaluation.updateGoldenCase");
        const value = await new UpdateGoldenCase({ cases: goldenCaseRepository() }).execute(
          goldenCaseId,
          {
            ...patch,
            now: now(),
          },
        );
        return { ok: true, value } as const;
      },
      { method: "POST", body: { goldenCaseId, ...patch } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function removeGoldenCaseAction(goldenCaseId: string): Promise<ActionResult<void>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "evaluation.removeGoldenCase");
        await new RemoveGoldenCase({ cases: goldenCaseRepository() }).execute(goldenCaseId, now());
        return { ok: true, value: undefined } as const;
      },
      { method: "POST", body: { goldenCaseId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

function runGoldenSetNowUseCase() {
  return new RunGoldenSetNow({
    sets: goldenSetRepository(),
    cases: goldenCaseRepository(),
    runs: regressionRunRepository(),
    conversations: evaluationConversationFactory(),
    ai: aiEvaluationClient(),
  });
}

/** B13 tab 1's **Run now** — rescores one set live, against the caller-supplied
 *  agent/version target (the last pairing the screen ran this set against, or one the
 *  staff member picks — see `run-golden-set-now.ts`'s own doc comment on why this module
 *  has no stored association to default from instead). */
export async function runGoldenSetNowAction(input: {
  readonly goldenSetId: string;
  readonly agentId: string;
  readonly agentVersionId: string;
}): Promise<ActionResult<RegressionRunRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "evaluation.runGoldenSetNow");
        const result = await runGoldenSetNowUseCase().execute({
          ...input,
          triggeredBy: "Manual",
          ranByStaffUserId: principal.id,
          now: now(),
        });
        if (!result.ok) return { ok: false, error: result.error } as const;
        return { ok: true, value: result.value } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 2 — Regression runs
// ---------------------------------------------------------------------------

export async function listRegressionRunsAction(): Promise<
  ActionResult<readonly RegressionRunRow[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "evaluation.listRegressionRuns");
      const value = await new ListRegressionRuns({ runs: regressionRunRepository() }).execute();
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function getRegressionRunAction(regressionRunId: string) {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "evaluation.getRegressionRun");
      const value = await new GetRegressionRun({ runs: regressionRunRepository() }).execute(
        regressionRunId,
      );
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** B13 tab 2's **Run all suites** — re-runs every `{goldenSetId, agentId,
 *  agentVersionId}` pairing this tenant's own regression history already contains (see
 *  `page.tsx`'s own derivation of `pairings` from `listRegressionRunsAction`'s result —
 *  "every pairing ever run before" is this module's chosen, documented interpretation of
 *  FR-EVAL-06 in the absence of a stored set/agent association). */
export async function runAllSuitesAction(
  pairings: readonly SuitePairing[],
): Promise<ActionResult<readonly RunAllSuitesOutcome[]>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "evaluation.runAllSuites");
        const value = await new RunAllSuites({ runGoldenSetNow: runGoldenSetNowUseCase() }).execute(
          {
            pairings,
            triggeredBy: "Manual",
            ranByStaffUserId: principal.id,
            now: now(),
          },
        );
        return { ok: true, value } as const;
      },
      { method: "POST", body: { pairings } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 3 — Publish gate
// ---------------------------------------------------------------------------

export async function getPublishGateAction(): Promise<ActionResult<PublishGateRow>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "evaluation.getPublishGate");
      const value = await new GetPublishGate({ gate: publishGateRepository() }).execute(
        principal.id,
        now(),
      );
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updatePublishGateAction(input: {
  readonly blockOnSuiteFailure: boolean;
  readonly minAccuracy: number;
  readonly minGroundedness: number;
  readonly redTeamMustScore100: boolean;
  readonly blockOnBoundLocaleBelow100: boolean;
}): Promise<ActionResult<PublishGateRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "evaluation.updatePublishGate");
        const value = await new UpdatePublishGate({
          gate: publishGateRepository(),
          audit: auditSink(),
        }).execute({ ...input, principal, now: now() });
        return { ok: true, value } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface GateStatusSummaryDisplay {
  readonly gateActive: boolean;
  readonly blockedVersion: {
    readonly agentName: string;
    readonly versionLabel: string;
    readonly reasons: readonly {
      readonly metric: string;
      readonly goldenSetId?: string;
      readonly goldenSetName?: string;
      readonly localeCode?: string;
      readonly observed: number;
      readonly threshold: number;
    }[];
  } | null;
}

/** Resolves the blocked version's real display name/label here (this action, an
 *  `app`-classified file, may import `agents` — `modules/evaluation` itself may not, see
 *  `get-gate-status-summary.ts`'s own doc comment). */
export async function getGateStatusSummaryAction(): Promise<
  ActionResult<GateStatusSummaryDisplay>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "evaluation.getGateStatusSummary");
      const summary = await new GetGateStatusSummary({
        gate: publishGateRepository(),
        evaluations: gateEvaluationRepository(),
      }).execute(principal.id, now());

      if (!summary.blockedVersion) {
        return {
          ok: true,
          value: { gateActive: summary.gateActive, blockedVersion: null },
        } as const;
      }

      const version = await agentRepository().getVersion(summary.blockedVersion.agentVersionId);
      const agent = version ? await agentRepository().getAgentDetail(version.agentId) : null;
      return {
        ok: true,
        value: {
          gateActive: summary.gateActive,
          blockedVersion: {
            agentName: agent?.name ?? "(unknown agent)",
            versionLabel: version?.label ?? "(unknown version)",
            reasons: summary.blockedVersion.reasons,
          },
        },
      } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
