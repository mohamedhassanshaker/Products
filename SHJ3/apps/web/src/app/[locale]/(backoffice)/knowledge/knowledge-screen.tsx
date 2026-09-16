"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { SubTabBar, SubTabBarPanel } from "@/components/ui/sub-tab-bar";
import type { GraphDuplicateCandidateRow } from "../../../../modules/knowledge/ports/graph-repository.js";
import type { GraphInvariantsResult } from "../../../../modules/knowledge/ports/knowledge-ai-client.js";
import type { KnowledgeSourceRow } from "../../../../modules/knowledge/ports/knowledge-source-repository.js";
import type { ReindexJobRow } from "../../../../modules/knowledge/ports/reindex-job-repository.js";
import type { RetrievalConfigRow } from "../../../../modules/knowledge/ports/retrieval-config-repository.js";
import type { SourceConflictRow } from "../../../../modules/knowledge/ports/conflict-repository.js";
import { SourcesTab } from "./sources-tab.js";
import { GraphTab } from "./graph-tab.js";
import { RetrievalTab } from "./retrieval-tab.js";
import { ConflictsTab } from "./conflicts-tab.js";
import type {
  addGraphNodeAction,
  addSourceAction,
  browseGraphAction,
  checkGraphInvariantsAction,
  deleteGraphNodeAction,
  detectDuplicatesAction,
  ignoreDuplicateAction,
  mergeDuplicateAction,
  recrawlSourceAction,
  removeSourceAction,
  resolveConflictAction,
  runRetrievalPlaygroundAction,
  triggerReindexAllAction,
  updateDefaultConflictPolicyAction,
  updateRetrievalConfigAction,
} from "./actions.js";

export interface KnowledgeScreenActions {
  readonly addSource: typeof addSourceAction;
  readonly recrawlSource: typeof recrawlSourceAction;
  readonly removeSource: typeof removeSourceAction;
  readonly browseGraph: typeof browseGraphAction;
  readonly addGraphNode: typeof addGraphNodeAction;
  readonly deleteGraphNode: typeof deleteGraphNodeAction;
  readonly detectDuplicates: typeof detectDuplicatesAction;
  readonly mergeDuplicate: typeof mergeDuplicateAction;
  readonly ignoreDuplicate: typeof ignoreDuplicateAction;
  readonly checkGraphInvariants: typeof checkGraphInvariantsAction;
  readonly updateRetrievalConfig: typeof updateRetrievalConfigAction;
  readonly runRetrievalPlayground: typeof runRetrievalPlaygroundAction;
  readonly triggerReindexAll: typeof triggerReindexAllAction;
  readonly resolveConflict: typeof resolveConflictAction;
  readonly updateDefaultConflictPolicy: typeof updateDefaultConflictPolicyAction;
}

export interface KnowledgeScreenProps {
  readonly sources: readonly KnowledgeSourceRow[];
  readonly retrievalConfig: RetrievalConfigRow;
  readonly reindexJobs: readonly ReindexJobRow[];
  readonly conflicts: readonly SourceConflictRow[];
  readonly duplicateCandidates: readonly GraphDuplicateCandidateRow[];
  readonly graphHealth: GraphInvariantsResult;
  readonly actions: KnowledgeScreenActions;
}

/** B6's four tabs, URL-synced (`?tab=`) — the same `SubTabBar` convention `tools-screen.tsx`/`iam-screen.tsx` already establish. */
export function KnowledgeScreen({
  sources,
  retrievalConfig,
  reindexJobs,
  conflicts,
  duplicateCandidates,
  graphHealth,
  actions,
}: KnowledgeScreenProps): React.ReactElement {
  const t = useTranslations("knowledge");

  const tabs = React.useMemo(
    () => [
      { value: "sources", label: t("tabs.sources") },
      { value: "graph", label: t("tabs.graph") },
      { value: "retrieval", label: t("tabs.retrieval") },
      { value: "conflicts", label: t("tabs.conflicts") },
    ],
    [t],
  );

  return (
    <SubTabBar tabs={tabs} aria-label={t("tabsAriaLabel")} urlParam="tab">
      <SubTabBarPanel value="sources">
        <SourcesTab rows={sources} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="graph">
        <GraphTab
          duplicateCandidates={duplicateCandidates}
          graphHealth={graphHealth}
          actions={actions}
        />
      </SubTabBarPanel>
      <SubTabBarPanel value="retrieval">
        <RetrievalTab config={retrievalConfig} reindexJobs={reindexJobs} actions={actions} />
      </SubTabBarPanel>
      <SubTabBarPanel value="conflicts">
        <ConflictsTab
          rows={conflicts}
          defaultConflictPolicy={retrievalConfig.defaultConflictPolicy}
          actions={actions}
        />
      </SubTabBarPanel>
    </SubTabBar>
  );
}
