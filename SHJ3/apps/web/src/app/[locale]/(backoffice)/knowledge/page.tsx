import { getTranslations } from "next-intl/server";
import { SignInPrompt } from "@/components/patterns/sign-in-prompt.js";
import { UnauthenticatedError } from "../../../../modules/iam/adapters/inbound/auth-middleware.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { PermissionDeniedError } from "../../../../modules/iam/domain/permissions.js";
import { CheckGraphInvariants } from "../../../../modules/knowledge/application/check-graph-invariants.js";
import type { GraphDuplicateCandidateRow } from "../../../../modules/knowledge/ports/graph-repository.js";
import type { GraphInvariantsResult } from "../../../../modules/knowledge/ports/knowledge-ai-client.js";
import type { KnowledgeSourceRow } from "../../../../modules/knowledge/ports/knowledge-source-repository.js";
import type { ReindexJobRow } from "../../../../modules/knowledge/ports/reindex-job-repository.js";
import type { RetrievalConfigRow } from "../../../../modules/knowledge/ports/retrieval-config-repository.js";
import type { SourceConflictRow } from "../../../../modules/knowledge/ports/conflict-repository.js";
import {
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
import {
  conflictRepository,
  graphRepository,
  knowledgeAiClient,
  knowledgeSourceRepository,
  reindexJobRepository,
  retrievalConfigRepository,
} from "./composition.js";
import { KnowledgeScreen } from "./knowledge-screen.js";

type PageData =
  | { readonly kind: "unauthenticated" }
  | { readonly kind: "forbidden" }
  | {
      readonly kind: "ok";
      readonly sources: readonly KnowledgeSourceRow[];
      readonly retrievalConfig: RetrievalConfigRow;
      readonly reindexJobs: readonly ReindexJobRow[];
      readonly conflicts: readonly SourceConflictRow[];
      readonly duplicateCandidates: readonly GraphDuplicateCandidateRow[];
      readonly graphHealth: GraphInvariantsResult;
    };

/**
 * `/knowledge` (B6: Knowledge / Graph RAG) — sources, entity graph, retrieval tuning and
 * source conflicts, gated on `knowledge:manage` (the `KnowledgeManager` role).
 *
 * Every query runs inside `withStaffAuth`'s handler, never after it returns — identical
 * rule to `tools/page.tsx`'s own doc comment, for the identical reason: `getTenantDb()`
 * only resolves inside the bound `TenantContext` that handler's callback provides.
 *
 * The graph explorer's own live search (FR-KNOW-08) fetches its own data client-side via
 * `browseGraphAction`, so this page seeds it with nothing more than the duplicates queue
 * and the graph-health banner — both of which are cheap, tenant-wide reads worth doing on
 * first paint rather than after an extra client round trip.
 */
export default async function KnowledgePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations("knowledge");

  let pageData: PageData;
  try {
    pageData = await withStaffAuth(async ({ principal }) => {
      try {
        requirePermission(principal, "knowledge:manage", "knowledge.page (visibility)");
      } catch (error) {
        if (error instanceof PermissionDeniedError) return { kind: "forbidden" } as const;
        throw error;
      }

      const [sources, retrievalConfig, reindexJobs, conflicts, duplicateCandidates, graphHealth] =
        await Promise.all([
          knowledgeSourceRepository().listSources(),
          retrievalConfigRepository().ensureTenantConfig(new Date()),
          reindexJobRepository().list(),
          conflictRepository().list(),
          graphRepository().listOpenDuplicateCandidates(),
          new CheckGraphInvariants({ ai: knowledgeAiClient() }).execute(),
        ]);

      return {
        kind: "ok",
        sources,
        retrievalConfig,
        reindexJobs,
        conflicts,
        duplicateCandidates,
        graphHealth,
      } as const;
    });
  } catch (error) {
    if (error instanceof UnauthenticatedError) {
      pageData = { kind: "unauthenticated" };
    } else {
      throw error;
    }
  }

  if (pageData.kind === "unauthenticated") {
    const tCommon = await getTranslations("common");
    return (
      <div className="flex flex-col gap-4">
        <SignInPrompt
          heading={t("pageTitle")}
          message={t("signInPrompt")}
          signInHref={`/${locale}/sign-in?next=${encodeURIComponent(`/${locale}/knowledge`)}`}
          signInLabel={tCommon("signInCta")}
        />
      </div>
    );
  }

  if (pageData.kind === "forbidden") {
    return (
      <div className="flex flex-col gap-4">
        <h1 className="text-lg font-semibold text-foreground">{t("permissionDeniedHeading")}</h1>
        <p className="text-sm text-muted-foreground">{t("permissionDeniedBody")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold text-foreground">{t("pageTitle")}</h1>
      <KnowledgeScreen
        sources={pageData.sources}
        retrievalConfig={pageData.retrievalConfig}
        reindexJobs={pageData.reindexJobs}
        conflicts={pageData.conflicts}
        duplicateCandidates={pageData.duplicateCandidates}
        graphHealth={pageData.graphHealth}
        actions={{
          addSource: addSourceAction,
          recrawlSource: recrawlSourceAction,
          removeSource: removeSourceAction,
          browseGraph: browseGraphAction,
          addGraphNode: addGraphNodeAction,
          deleteGraphNode: deleteGraphNodeAction,
          detectDuplicates: detectDuplicatesAction,
          mergeDuplicate: mergeDuplicateAction,
          ignoreDuplicate: ignoreDuplicateAction,
          checkGraphInvariants: checkGraphInvariantsAction,
          updateRetrievalConfig: updateRetrievalConfigAction,
          runRetrievalPlayground: runRetrievalPlaygroundAction,
          triggerReindexAll: triggerReindexAllAction,
          resolveConflict: resolveConflictAction,
          updateDefaultConflictPolicy: updateDefaultConflictPolicyAction,
        }}
      />
    </div>
  );
}
