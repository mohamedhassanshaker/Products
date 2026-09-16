"use server";

/**
 * Server Actions for `/governance` (B14: Environments & promotions, audit log,
 * observability, privacy & data).
 *
 * Every action here gates on the single `governance:manage` permission (real key in
 * `modules/iam/domain/permissions.ts`, granted to `SuperAdmin`/`EntityAdmin`) — checked
 * here, in the caller, per api.md §12 invariant 2; the use cases in `modules/governance/
 * application` do not check permissions themselves.
 */
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { ListEnvironments } from "../../../../modules/governance/application/list-environments.js";
import { ListPendingPromotions } from "../../../../modules/governance/application/list-pending-promotions.js";
import { RequestPromotion } from "../../../../modules/governance/application/request-promotion.js";
import { ApprovePromotion } from "../../../../modules/governance/application/approve-promotion.js";
import { RejectPromotion } from "../../../../modules/governance/application/reject-promotion.js";
import { ListAuditLog } from "../../../../modules/governance/application/list-audit-log.js";
import { GetAuditEntry } from "../../../../modules/governance/application/get-audit-entry.js";
import { GetObservability } from "../../../../modules/governance/application/get-observability.js";
import { RecordServiceHealthSample } from "../../../../modules/governance/application/record-service-health-sample.js";
import {
  GetPrivacyConfig,
  type GetPrivacyConfigResult,
} from "../../../../modules/governance/application/get-privacy-config.js";
import { UpdatePrivacyConfig } from "../../../../modules/governance/application/update-privacy-config.js";
import { CreateErasureRequest } from "../../../../modules/governance/application/create-erasure-request.js";
import { ProcessErasureRequest } from "../../../../modules/governance/application/process-erasure-request.js";
import { RunRetentionSweep } from "../../../../modules/governance/application/run-retention-sweep.js";
import type { EnvironmentRow } from "../../../../modules/governance/ports/environment-repository.js";
import type { PromotionRequestRow } from "../../../../modules/governance/ports/promotion-repository.js";
import type {
  AuditLogEntryRow,
  AuditLogFilter,
  AuditLogPage,
} from "../../../../modules/governance/ports/audit-log-repository.js";
import type { ServiceHealthSampleRow } from "../../../../modules/governance/ports/service-health-repository.js";
import type {
  ErasureRequestRow,
  ErasureTaskRow,
} from "../../../../modules/governance/ports/erasure-request-repository.js";
import type { RetentionSweepRunRow } from "../../../../modules/governance/ports/retention-sweep-repository.js";
import {
  auditLogRepository,
  auditSink,
  citizenCacheEraser,
  citizenDataEraser,
  environmentRepository,
  erasureRequestRepository,
  graphVectorErasureVerifier,
  now,
  orchestrationStepSampleRepository,
  privacyConfigRepository,
  promotionRequestRepository,
  publishGateChecker,
  retentionSweepDataRepository,
  retentionSweepRunRepository,
  serviceHealthRepository,
} from "./composition.js";

const PERMISSION = "governance:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ---------------------------------------------------------------------------
// Tab 1 — Environments & promotions
// ---------------------------------------------------------------------------

export async function listEnvironmentsAction(): Promise<ActionResult<readonly EnvironmentRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.listEnvironments");
      const value = await new ListEnvironments({ environments: environmentRepository() }).execute();
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listPendingPromotionsAction(): Promise<
  ActionResult<readonly PromotionRequestRow[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.listPendingPromotions");
      const value = await new ListPendingPromotions({
        promotions: promotionRequestRepository(),
      }).execute();
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface RequestPromotionFormInput {
  readonly agentVersionId: string;
  readonly fromEnvironmentKey: string;
  readonly toEnvironmentKey: string;
}

export async function requestPromotionAction(
  input: RequestPromotionFormInput,
): Promise<ActionResult<Awaited<ReturnType<RequestPromotion["execute"]>>>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "governance.requestPromotion");
        const value = await new RequestPromotion({
          promotions: promotionRequestRepository(),
          environments: environmentRepository(),
          gate: publishGateChecker(),
        }).execute({ ...input, requestedByStaffUserId: principal.id, now: now() });
        return { ok: true, value } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function approvePromotionAction(
  promotionRequestId: string,
): Promise<ActionResult<void>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "governance.approvePromotion");
        await new ApprovePromotion({ promotions: promotionRequestRepository() }).execute({
          promotionRequestId,
          decidedByStaffUserId: principal.id,
          now: now(),
        });
        return { ok: true, value: undefined } as const;
      },
      { method: "POST", body: { promotionRequestId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function rejectPromotionAction(
  promotionRequestId: string,
  decisionNote: string,
): Promise<ActionResult<void>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "governance.rejectPromotion");
        await new RejectPromotion({ promotions: promotionRequestRepository() }).execute({
          promotionRequestId,
          decidedByStaffUserId: principal.id,
          decisionNote,
          now: now(),
        });
        return { ok: true, value: undefined } as const;
      },
      { method: "POST", body: { promotionRequestId, decisionNote } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 2 — Audit log
// ---------------------------------------------------------------------------

export async function listAuditLogAction(
  filter: AuditLogFilter,
): Promise<ActionResult<AuditLogPage>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.listAuditLog");
      const value = await new ListAuditLog({ auditLog: auditLogRepository() }).execute(filter);
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function getAuditEntryAction(id: string): Promise<ActionResult<AuditLogEntryRow>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.getAuditEntry");
      const value = await new GetAuditEntry({ auditLog: auditLogRepository() }).execute(id);
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 3 — Observability
// ---------------------------------------------------------------------------

export async function getObservabilityAction(): Promise<
  ActionResult<readonly ServiceHealthSampleRow[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.getObservability");
      const value = await new GetObservability({ samples: serviceHealthRepository() }).execute();
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** B14 tab 3's "Recompute now" — see `RecordServiceHealthSample`'s own doc comment for
 *  why this is on-demand rather than continuous. */
export async function recomputeObservabilityAction(): Promise<
  ActionResult<readonly ServiceHealthSampleRow[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.recomputeObservability");
      const recordSample = new RecordServiceHealthSample({
        steps: orchestrationStepSampleRepository(),
        samples: serviceHealthRepository(),
      });
      const windowEnd = now();
      const windowStart = new Date(windowEnd.getTime() - 60 * 60 * 1000);
      await Promise.all([
        recordSample.execute({
          targetKind: "McpTool",
          targetKey: "mcp-tool",
          displayName: "Sharjah Services Gateway (MCP)",
          windowStart,
          windowEnd,
        }),
        recordSample.execute({
          targetKind: "GraphRetrieval",
          targetKey: "graph-rag-retrieval",
          displayName: "Graph RAG retrieval",
          windowStart,
          windowEnd,
        }),
      ]);
      const value = await new GetObservability({ samples: serviceHealthRepository() }).execute();
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

// ---------------------------------------------------------------------------
// Tab 4 — Privacy & data
// ---------------------------------------------------------------------------

export async function getPrivacyConfigAction(): Promise<ActionResult<GetPrivacyConfigResult>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.getPrivacyConfig");
      const value = await new GetPrivacyConfig({
        privacyConfig: privacyConfigRepository(),
      }).execute();
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface UpdatePrivacyConfigFormInput {
  readonly consentLedgerEnabled: boolean;
  readonly honourErasureRequests: boolean;
  readonly transcriptRetention: string;
  readonly dataResidency: string;
}

export async function updatePrivacyConfigAction(
  input: UpdatePrivacyConfigFormInput,
): Promise<ActionResult<Awaited<ReturnType<UpdatePrivacyConfig["execute"]>>>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "governance.updatePrivacyConfig");
        const value = await new UpdatePrivacyConfig({
          privacyConfig: privacyConfigRepository(),
          audit: auditSink(),
        }).execute({ ...input, actor: principal, now: now() });
        return { ok: true, value } as const;
      },
      { method: "PUT", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listErasureRequestsAction(): Promise<
  ActionResult<readonly ErasureRequestRow[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.listErasureRequests");
      const value = await erasureRequestRepository().list();
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export interface CreateErasureRequestFormInput {
  readonly subjectKind: string;
  readonly subjectHash: string;
  readonly citizenIdentityId: string | null;
  readonly receivedVia: string;
}

export async function createErasureRequestAction(
  input: CreateErasureRequestFormInput,
): Promise<ActionResult<ErasureRequestRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "governance.createErasureRequest");
        const value = await new CreateErasureRequest({
          erasureRequests: erasureRequestRepository(),
          audit: auditSink(),
        }).execute({ ...input, actor: principal, now: now() });
        return { ok: true, value } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function processErasureRequestAction(
  erasureRequestId: string,
): Promise<
  ActionResult<{ readonly completed: boolean; readonly tasks: readonly ErasureTaskRow[] }>
> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "governance.processErasureRequest");
        const value = await new ProcessErasureRequest({
          erasureRequests: erasureRequestRepository(),
          sqlEraser: citizenDataEraser(),
          cacheEraser: citizenCacheEraser(),
          graphVectorVerifier: graphVectorErasureVerifier(),
          audit: auditSink(),
        }).execute({ erasureRequestId, actor: principal, now: now() });
        return { ok: true, value } as const;
      },
      { method: "POST", body: { erasureRequestId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function runRetentionSweepAction(): Promise<ActionResult<RetentionSweepRunRow>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.runRetentionSweep");
      const value = await new RunRetentionSweep({
        privacyConfig: privacyConfigRepository(),
        data: retentionSweepDataRepository(),
        cache: citizenCacheEraser(),
        runs: retentionSweepRunRepository(),
        audit: auditSink(),
      }).execute({ actor: principal, now: now() });
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function listRetentionSweepRunsAction(): Promise<
  ActionResult<readonly RetentionSweepRunRow[]>
> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "governance.listRetentionSweepRuns");
      const value = await retentionSweepRunRepository().list(10);
      return { ok: true, value } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
