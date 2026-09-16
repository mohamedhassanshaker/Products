"use server";

/**
 * Server Actions for `/knowledge` (B6: Knowledge / Graph RAG) — every write on all four
 * tabs. Gated on `knowledge:manage` (the `KnowledgeManager` role), checked here per api.md
 * §12 invariant 2 — `modules/knowledge`'s use cases do not check permissions themselves.
 * Same `ActionResult<UseCaseResult>` two-layer convention `tools/actions.ts`'s own module
 * comment documents in full: outer `ok`/`error` for "did the call complete", inner
 * `ok`/`reason` for "what did the business rule decide".
 *
 * `addSourceAction`/`recrawlSourceAction` both also process the outbox synchronously,
 * inline, right after their own write — the pragmatic reason named in the top-level brief:
 * no separate `shj3-worker` deployable exists yet in this repo, and a demo should not
 * depend on `scripts/process-knowledge-outbox.ts`'s polling loop being up. Same reasoning
 * for `triggerReindexAllAction` running the created job inline via `RunReindexJob` — no
 * asynchronous executor exists for `ReindexJobs` either.
 */

import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { AddGraphNode } from "../../../../modules/knowledge/application/add-graph-node.js";
import { AddSource } from "../../../../modules/knowledge/application/add-source.js";
import { BrowseGraph } from "../../../../modules/knowledge/application/browse-graph.js";
import { CheckGraphInvariants } from "../../../../modules/knowledge/application/check-graph-invariants.js";
import { DeleteGraphNode } from "../../../../modules/knowledge/application/delete-graph-node.js";
import { DetectDuplicates } from "../../../../modules/knowledge/application/detect-duplicates.js";
import { IgnoreDuplicate } from "../../../../modules/knowledge/application/ignore-duplicate.js";
import { MergeDuplicate } from "../../../../modules/knowledge/application/merge-duplicate.js";
import { ProcessKnowledgeOutbox } from "../../../../modules/knowledge/application/process-knowledge-outbox.js";
import { RecrawlSource } from "../../../../modules/knowledge/application/recrawl-source.js";
import { RemoveSource } from "../../../../modules/knowledge/application/remove-source.js";
import { ResolveConflict } from "../../../../modules/knowledge/application/resolve-conflict.js";
import { RunReindexJob } from "../../../../modules/knowledge/application/run-reindex-job.js";
import { RunRetrievalPlayground } from "../../../../modules/knowledge/application/run-retrieval-playground.js";
import { TriggerReindexAll } from "../../../../modules/knowledge/application/trigger-reindex-all.js";
import { UpdateRetrievalConfig } from "../../../../modules/knowledge/application/update-retrieval-config.js";
import type { AddGraphNodeResult } from "../../../../modules/knowledge/application/add-graph-node.js";
import type { AddSourceResult } from "../../../../modules/knowledge/application/add-source.js";
import type { DeleteGraphNodeResult } from "../../../../modules/knowledge/application/delete-graph-node.js";
import type { DetectDuplicatesResult } from "../../../../modules/knowledge/application/detect-duplicates.js";
import type { IgnoreDuplicateResult } from "../../../../modules/knowledge/application/ignore-duplicate.js";
import type { MergeDuplicateResult } from "../../../../modules/knowledge/application/merge-duplicate.js";
import type { RecrawlSourceResult } from "../../../../modules/knowledge/application/recrawl-source.js";
import type { RemoveSourceResult } from "../../../../modules/knowledge/application/remove-source.js";
import type { ResolveConflictResult } from "../../../../modules/knowledge/application/resolve-conflict.js";
import type { RunRetrievalPlaygroundResult } from "../../../../modules/knowledge/application/run-retrieval-playground.js";
import type { TriggerReindexAllResult } from "../../../../modules/knowledge/application/trigger-reindex-all.js";
import type { UpdateRetrievalConfigResult } from "../../../../modules/knowledge/application/update-retrieval-config.js";
import type {
  ConflictPolicy,
  ConflictSide,
  GraphLabel,
  GraphRelationshipType,
  SourceSchedule,
  SourceType,
} from "../../../../modules/knowledge/domain/knowledge-catalog.js";
import type { GraphBrowseResult } from "../../../../modules/knowledge/ports/knowledge-ai-client.js";
import type { ReindexJobRow } from "../../../../modules/knowledge/ports/reindex-job-repository.js";
import {
  chunkRepository,
  conflictRepository,
  graphRepository,
  knowledgeAiClient,
  knowledgeSourceRepository,
  now,
  outboxRepository,
  reindexJobRepository,
  retrievalConfigRepository,
} from "./composition.js";

const MANAGE_PERMISSION = "knowledge:manage" as const;
const OUTBOX_BATCH_SIZE = 64;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Drains the outbox once, inline — see this file's own module comment. Errors are swallowed into a console warning: outbox processing is a best-effort accelerant here, never something that should turn a successful ingest into a failed Server Action. */
async function drainOutboxInline(): Promise<void> {
  try {
    await new ProcessKnowledgeOutbox({
      outbox: outboxRepository(),
      chunks: chunkRepository(),
      graph: graphRepository(),
      retrievalConfig: retrievalConfigRepository(),
      ai: knowledgeAiClient(),
    }).execute({ batchSize: OUTBOX_BATCH_SIZE, workerId: "inline-server-action", now: now() });
  } catch (error) {
    console.warn(
      "[knowledge/actions] inline outbox drain failed; the background loop will retry it.",
      error,
    );
  }
}

// ---------------------------------------------------------------------------
// Tab 1 — Sources
// ---------------------------------------------------------------------------

export interface AddSourceActionInput {
  readonly name: string;
  readonly sourceType: SourceType;
  readonly location: string;
  readonly schedule: SourceSchedule;
  readonly credentialSecretRef: string | null;
  readonly documentText: string | null;
  readonly localeCode: string;
}

export async function addSourceAction(
  input: AddSourceActionInput,
): Promise<ActionResult<AddSourceResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.addSource");
        const result = await new AddSource({
          sources: knowledgeSourceRepository(),
          chunks: chunkRepository(),
          retrievalConfig: retrievalConfigRepository(),
          ai: knowledgeAiClient(),
        }).execute({ ...input, ranByStaffUserId: principal.id, now: now() });
        // Drained INSIDE this callback, deliberately — the bound tenant context
        // (AsyncLocalStorage) does not survive past withStaffAuth's own callback
        // (lessons.md), and drainOutboxInline() needs it (getTenantDb()/
        // createTenantScopedAiClient() both read it).
        if (result.chunksWritten > 0) await drainOutboxInline();
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function recrawlSourceAction(
  knowledgeSourceId: string,
): Promise<ActionResult<RecrawlSourceResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.recrawlSource");
        const result = await new RecrawlSource({
          sources: knowledgeSourceRepository(),
          chunks: chunkRepository(),
          retrievalConfig: retrievalConfigRepository(),
          ai: knowledgeAiClient(),
        }).execute({ knowledgeSourceId, ranByStaffUserId: principal.id, now: now() });
        if (result.ok && result.chunksWritten > 0) await drainOutboxInline();
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { knowledgeSourceId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function removeSourceAction(
  knowledgeSourceId: string,
): Promise<ActionResult<RemoveSourceResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.removeSource");
        const result = await new RemoveSource({
          sources: knowledgeSourceRepository(),
          chunks: chunkRepository(),
          graph: graphRepository(),
          ai: knowledgeAiClient(),
        }).execute({ knowledgeSourceId, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { knowledgeSourceId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 2 — Graph explorer & duplicates
// ---------------------------------------------------------------------------

export interface BrowseGraphActionInput {
  readonly rootKey: string | null;
  readonly depth: number;
  readonly types: readonly string[] | null;
  readonly limit: number;
}

export async function browseGraphAction(
  input: BrowseGraphActionInput,
): Promise<ActionResult<GraphBrowseResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.browseGraph");
        const result = await new BrowseGraph({ ai: knowledgeAiClient() }).execute(input);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface AddGraphNodeActionInput {
  readonly label: GraphLabel;
  readonly canonicalKey: string;
  readonly canonicalName: string;
  readonly parent: { readonly label: GraphLabel; readonly canonicalKey: string } | null;
  readonly relationshipType: GraphRelationshipType | null;
}

export async function addGraphNodeAction(
  input: AddGraphNodeActionInput,
): Promise<ActionResult<AddGraphNodeResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.addGraphNode");
        const result = await new AddGraphNode({
          graph: graphRepository(),
          ai: knowledgeAiClient(),
        }).execute({
          ...input,
          actorStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function deleteGraphNodeAction(
  nodeId: string,
): Promise<ActionResult<DeleteGraphNodeResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.deleteGraphNode");
        const result = await new DeleteGraphNode({
          graph: graphRepository(),
          ai: knowledgeAiClient(),
        }).execute({
          nodeId,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { nodeId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function detectDuplicatesAction(
  label: GraphLabel,
): Promise<ActionResult<DetectDuplicatesResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.detectDuplicates");
        const result = await new DetectDuplicates({
          graph: graphRepository(),
          ai: knowledgeAiClient(),
        }).execute({
          label,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { label } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function mergeDuplicateAction(
  candidateId: string,
): Promise<ActionResult<MergeDuplicateResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.mergeDuplicate");
        const result = await new MergeDuplicate({
          graph: graphRepository(),
          ai: knowledgeAiClient(),
        }).execute({
          candidateId,
          actorStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { candidateId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function ignoreDuplicateAction(
  candidateId: string,
): Promise<ActionResult<IgnoreDuplicateResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.ignoreDuplicate");
        const result = await new IgnoreDuplicate({
          graph: graphRepository(),
          ai: knowledgeAiClient(),
        }).execute({
          candidateId,
          actorStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { candidateId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function checkGraphInvariantsAction(): Promise<
  ActionResult<{
    readonly labelledButWrongProp: number;
    readonly propButNoLabel: number;
    readonly crossTenantEdges: number;
  }>
> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.checkGraphInvariants");
        const result = await new CheckGraphInvariants({ ai: knowledgeAiClient() }).execute();
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: {} },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 3 — Retrieval config, playground, re-index
// ---------------------------------------------------------------------------

export interface UpdateRetrievalConfigActionInput {
  readonly chunkSizeTokens: number;
  readonly chunkOverlapTokens: number;
  readonly embeddingModel: string;
  readonly embeddingDimension: number;
  readonly graphWeight: number;
  readonly vectorWeight: number;
  readonly topK: number;
  readonly rerankerEnabled: boolean;
  readonly rerankerModel: string | null;
  readonly rerankCandidateCount: number;
  readonly minGroundingConfidence: number;
  readonly defaultConflictPolicy: ConflictPolicy;
  readonly maxGraphHops: number;
}

/** The action's response also carries the refreshed job list when the model changed — "you do not need to create the job yourself, just surface that one was queued" (the top-level brief's own wording for FR-KNOW-13). */
export interface UpdateRetrievalConfigActionResult {
  readonly update: UpdateRetrievalConfigResult;
  readonly reindexJobs: readonly ReindexJobRow[] | null;
}

export async function updateRetrievalConfigAction(
  input: UpdateRetrievalConfigActionInput,
): Promise<ActionResult<UpdateRetrievalConfigActionResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.updateRetrievalConfig");
        const update = await new UpdateRetrievalConfig({
          retrievalConfig: retrievalConfigRepository(),
        }).execute({
          ...input,
          now: now(),
        });
        const reindexJobs =
          update.ok && update.modelChanged ? await reindexJobRepository().list() : null;
        return { ok: true, value: { update, reindexJobs } } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface RunRetrievalPlaygroundActionInput {
  readonly query: string;
  readonly knowledgeCollectionIds: readonly string[] | null;
}

export async function runRetrievalPlaygroundAction(
  input: RunRetrievalPlaygroundActionInput,
): Promise<ActionResult<RunRetrievalPlaygroundResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.runRetrievalPlayground");
        const result = await new RunRetrievalPlayground({
          retrievalConfig: retrievalConfigRepository(),
          ai: knowledgeAiClient(),
        }).execute({ ...input, ranByStaffUserId: principal.id, now: now() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function triggerReindexAllAction(): Promise<ActionResult<TriggerReindexAllResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.triggerReindexAll");
        const deps = {
          reindexJobs: reindexJobRepository(),
          chunks: chunkRepository(),
          graph: graphRepository(),
          retrievalConfig: retrievalConfigRepository(),
          ai: knowledgeAiClient(),
        };
        const triggered = await new TriggerReindexAll(deps).execute({
          ranByStaffUserId: principal.id,
          now: now(),
        });
        if (triggered.ok) {
          // No asynchronous job executor exists yet — run it inline so B6 tab 3's job
          // history shows a real, completed (or honestly failed) job rather than one stuck
          // forever at Queued.
          await new RunReindexJob(deps).execute({ jobId: triggered.job.id, now: now() });
        }
        return { ok: true, value: triggered } as const;
      },
      { method: "POST", body: {} },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 4 — Conflicts
// ---------------------------------------------------------------------------

export interface ResolveConflictActionInput {
  readonly conflictId: string;
  readonly authoritativeSide: ConflictSide;
}

export async function resolveConflictAction(
  input: ResolveConflictActionInput,
): Promise<ActionResult<ResolveConflictResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.resolveConflict");
        const result = await new ResolveConflict({ conflicts: conflictRepository() }).execute({
          ...input,
          resolvedByStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** FR-KNOW-19: saves the tenant's default conflict-resolution policy — reuses `UpdateRetrievalConfig` with every other field left at its current value, since the policy lives on the same `RetrievalConfig` row. */
export async function updateDefaultConflictPolicyAction(
  defaultConflictPolicy: UpdateRetrievalConfigActionInput["defaultConflictPolicy"],
): Promise<ActionResult<UpdateRetrievalConfigResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, MANAGE_PERMISSION, "knowledge.updateDefaultConflictPolicy");
        const configs = retrievalConfigRepository();
        const current = await configs.ensureTenantConfig(now());
        const result = await new UpdateRetrievalConfig({ retrievalConfig: configs }).execute({
          chunkSizeTokens: current.chunkSizeTokens,
          chunkOverlapTokens: current.chunkOverlapTokens,
          embeddingModel: current.embeddingModel,
          embeddingDimension: current.embeddingDimension,
          graphWeight: current.graphWeight,
          vectorWeight: current.vectorWeight,
          topK: current.topK,
          rerankerEnabled: current.rerankerEnabled,
          rerankerModel: current.rerankerModel,
          rerankCandidateCount: current.rerankCandidateCount,
          minGroundingConfidence: current.minGroundingConfidence,
          defaultConflictPolicy,
          maxGraphHops: current.maxGraphHops,
          now: now(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { defaultConflictPolicy } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
