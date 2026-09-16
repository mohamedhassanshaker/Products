"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { GoldenSetRow } from "../../../../modules/evaluation/ports/golden-set-repository.js";
import type { PublishGateRow } from "../../../../modules/evaluation/ports/publish-gate-repository.js";
import type { RegressionRunRow } from "../../../../modules/evaluation/ports/regression-run-repository.js";
import { GoldenSetsTab } from "./golden-sets-tab.js";
import { PublishGateTab } from "./publish-gate-tab.js";
import { RegressionRunsTab } from "./regression-runs-tab.js";
import type {
  addCaseFromTranscriptAction,
  addGoldenCaseAction,
  createGoldenSetAction,
  getGateStatusSummaryAction,
  getGoldenSetAction,
  getRegressionRunAction,
  removeGoldenCaseAction,
  runAllSuitesAction,
  runGoldenSetNowAction,
  updateGoldenCaseAction,
  updatePublishGateAction,
  GateStatusSummaryDisplay,
} from "./actions.js";

export interface EvaluationScreenActions {
  readonly getGoldenSet: typeof getGoldenSetAction;
  readonly createGoldenSet: typeof createGoldenSetAction;
  readonly addGoldenCase: typeof addGoldenCaseAction;
  readonly addCaseFromTranscript: typeof addCaseFromTranscriptAction;
  readonly updateGoldenCase: typeof updateGoldenCaseAction;
  readonly removeGoldenCase: typeof removeGoldenCaseAction;
  readonly runGoldenSetNow: typeof runGoldenSetNowAction;
  readonly getRegressionRun: typeof getRegressionRunAction;
  readonly runAllSuites: typeof runAllSuitesAction;
  readonly updatePublishGate: typeof updatePublishGateAction;
  readonly getGateStatusSummary: typeof getGateStatusSummaryAction;
}

export interface EvaluationScreenProps {
  readonly goldenSets: readonly GoldenSetRow[];
  readonly regressionRuns: readonly RegressionRunRow[];
  readonly publishGate: PublishGateRow;
  readonly gateStatus: GateStatusSummaryDisplay;
  readonly actions: EvaluationScreenActions;
}

/** B13 in full — golden sets, regression runs, and the publish gate. One real permission
 *  (`evaluation:manage`) gates the whole page, so all three tabs render for anyone who
 *  reaches this screen at all (unlike `escalations`' two-permission split). */
export function EvaluationScreen({
  goldenSets,
  regressionRuns,
  publishGate,
  gateStatus,
  actions,
}: EvaluationScreenProps): React.ReactElement {
  const t = useTranslations("evaluation");
  const [runs, setRuns] = React.useState(regressionRuns);
  const [sets, setSets] = React.useState(goldenSets);

  const tabs = React.useMemo(
    () => [
      { value: "golden-sets", label: t("tabs.goldenSets") },
      { value: "regression-runs", label: t("tabs.regressionRuns") },
      { value: "publish-gate", label: t("tabs.publishGate") },
    ],
    [t],
  );

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      <SubTabBarPanel value="golden-sets">
        <GoldenSetsTab
          goldenSets={sets}
          regressionRuns={runs}
          actions={actions}
          onSetsChanged={setSets}
          onRunRecorded={(run) => setRuns((prev) => [run, ...prev])}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="regression-runs">
        <RegressionRunsTab
          regressionRuns={runs}
          actions={actions}
          onRunsRecorded={(newRuns) => setRuns((prev) => [...newRuns, ...prev])}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="publish-gate">
        <PublishGateTab publishGate={publishGate} gateStatus={gateStatus} actions={actions} />
      </SubTabBarPanel>
    </SubTabBar>
  );
}
