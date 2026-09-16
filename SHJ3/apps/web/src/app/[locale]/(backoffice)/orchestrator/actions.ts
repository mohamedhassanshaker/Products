"use server";

/**
 * Server Actions for `/orchestrator` — B4's editing surface (execution mode, agent
 * combination scope, ceilings, merge/conflict policy) plus the read-only trace picker and
 * the live "test a prompt" simulator.
 *
 * Regated from `analytics:view` to `orchestration:manage` (2026-09-15): this screen moved
 * from a read-only diagnostic view to a real config-editing + preview surface, the same
 * release-governance class of permission `evaluation:manage`/`governance:manage`/
 * `security:manage` already are — see `modules/iam/domain/permissions.ts`'s own doc
 * comment on `orchestration:manage`. Real, disclosed consequence: `Reviewer`/`Analyst`
 * roles, which held `analytics:view`, lose visibility into this screen entirely, since only
 * `SuperAdmin`/`EntityAdmin` hold the new permission.
 */
import { requirePermission } from "../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../modules/iam/adapters/inbound/next-request-context.js";
import { GetTraceDetail } from "../../../../modules/orchestration/application/get-trace-detail.js";
import {
  UpdateRouterConfig,
  type UpdateRouterConfigInput,
  type UpdateRouterConfigResult,
} from "../../../../modules/orchestration/application/update-router-config.js";
import type { OrchestrationTraceDetail } from "../../../../modules/orchestration/ports/orchestration-trace-repository.js";
import type {
  PreviewTraceInput,
  PreviewTraceResult,
} from "../../../../modules/orchestration/ports/orchestration-preview-client.js";
import {
  orchestrationPreviewClient,
  orchestrationTraceRepository,
  publishedAgentPort,
  routerConfigRepository,
} from "./composition.js";

const PERMISSION = "orchestration:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function getTraceDetailAction(
  traceId: string,
): Promise<ActionResult<OrchestrationTraceDetail>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.getTraceDetail");
        const result = await new GetTraceDetail({
          traces: orchestrationTraceRepository(),
        }).execute(traceId);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { traceId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updateRouterConfigAction(
  input: UpdateRouterConfigInput,
): Promise<ActionResult<UpdateRouterConfigResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.updateRouterConfig");
        const result = await new UpdateRouterConfig({
          routerConfig: routerConfigRepository(),
          agents: publishedAgentPort(),
        }).execute(input);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/**
 * Direct passthrough to `OrchestrationPreviewClient` — no application-layer use case, the
 * same shape `sendSandboxTurnAction` (`(backoffice)/agents/actions.ts`) already establishes
 * for a call with no domain write logic of its own: the real logic lives entirely in
 * `apps/ai`'s `ProcessTurn` pipeline, validated against the tenant's real, already-saved
 * `RouterConfig` on the far side.
 */
export async function previewTraceAction(
  input: PreviewTraceInput,
): Promise<ActionResult<PreviewTraceResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.previewTrace");
        const result = await orchestrationPreviewClient().previewTrace(input);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}
