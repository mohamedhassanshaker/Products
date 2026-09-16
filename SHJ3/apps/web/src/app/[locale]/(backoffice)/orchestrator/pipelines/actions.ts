"use server";

/**
 * Server Actions for `/orchestrator/pipelines` — the Pipeline Designer's own list + editor
 * surface. Gated on the same `orchestration:manage` permission the rest of `/orchestrator`
 * already uses (this feature's own design decision: no narrower permission is seeded, since
 * both roles holding `orchestration:manage` already hold `agents:publish`).
 */
import { requirePermission } from "../../../../../modules/iam/application/require-permission.js";
import { withStaffAuth } from "../../../../../modules/iam/adapters/inbound/next-request-context.js";
import { ListPipelines } from "../../../../../modules/orchestration/application/list-pipelines.js";
import { CreatePipeline, type CreatePipelineResult } from "../../../../../modules/orchestration/application/create-pipeline.js";
import { GetPipelineCanvas } from "../../../../../modules/orchestration/application/get-pipeline-canvas.js";
import { GetOrCreateDraftPipelineVersion } from "../../../../../modules/orchestration/application/get-or-create-draft-pipeline-version.js";
import { CreatePipelineNode } from "../../../../../modules/orchestration/application/create-pipeline-node.js";
import { UpdatePipelineNode } from "../../../../../modules/orchestration/application/update-pipeline-node.js";
import { DeletePipelineNode } from "../../../../../modules/orchestration/application/delete-pipeline-node.js";
import { CreatePipelineEdge, type CreatePipelineEdgeResult } from "../../../../../modules/orchestration/application/create-pipeline-edge.js";
import { UpdatePipelineEdge, type UpdatePipelineEdgeResult } from "../../../../../modules/orchestration/application/update-pipeline-edge.js";
import { DeletePipelineEdge } from "../../../../../modules/orchestration/application/delete-pipeline-edge.js";
import { SetPipelineEntryNode } from "../../../../../modules/orchestration/application/set-pipeline-entry-node.js";
import { PublishPipelineVersion, type PublishPipelineVersionResult } from "../../../../../modules/orchestration/application/publish-pipeline-version.js";
import { SetActivePipelineVersion, type SetActivePipelineVersionResult } from "../../../../../modules/orchestration/application/set-active-pipeline-version.js";
import { RollbackPipelineVersion, type RollbackPipelineVersionResult } from "../../../../../modules/orchestration/application/rollback-pipeline-version.js";
import { GetPipelineVersionHistory } from "../../../../../modules/orchestration/application/get-pipeline-version-history.js";
import type {
  NewPipelineEdgeInput,
  PipelineCanvas,
  PipelineDesignRow,
  PipelineEdgeRow,
  PipelineNodeRow,
  PipelineVersionHistoryEntryRow,
  UpdatePipelineEdgeInput,
  UpdatePipelineNodeInput,
} from "../../../../../modules/orchestration/ports/pipeline-repository.js";
import type {
  ValidatePipelineConditionResult,
  ValidatePipelineGraphInput,
  ValidatePipelineGraphResult,
} from "../../../../../modules/orchestration/ports/pipeline-validation-client.js";
import type { CreatePipelineNodeInput } from "../../../../../modules/orchestration/application/create-pipeline-node.js";
import {
  pipelineRepository,
  pipelineValidationClient,
  publishedAgentPort,
  resolveOwnerTenantId,
  routerConfigRepository,
} from "../composition.js";

const PERMISSION = "orchestration:manage" as const;

export type ActionResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string };

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function listPipelinesAction(): Promise<ActionResult<readonly PipelineDesignRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "orchestrator.listPipelines");
      const rows = await new ListPipelines({ pipelines: pipelineRepository() }).execute();
      return { ok: true, value: rows } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function createPipelineAction(input: {
  readonly name: string;
}): Promise<ActionResult<CreatePipelineResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.createPipeline");
        const ownerTenantId = await resolveOwnerTenantId();
        const result = await new CreatePipeline({ pipelines: pipelineRepository() }).execute({
          name: input.name,
          ownerTenantId,
          createdByStaffUserId: principal.id,
          now: new Date(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function getOrCreateDraftPipelineVersionAction(
  pipelineDesignId: string,
): Promise<ActionResult<{ readonly pipelineVersionId: string }>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.getOrCreateDraftPipelineVersion");
        const result = await new GetOrCreateDraftPipelineVersion({
          pipelines: pipelineRepository(),
        }).execute({ pipelineDesignId, actorStaffUserId: principal.id, now: new Date() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { pipelineDesignId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function getPipelineCanvasAction(
  pipelineVersionId: string,
): Promise<ActionResult<PipelineCanvas | null>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "orchestrator.getPipelineCanvas");
      const canvas = await new GetPipelineCanvas({ pipelines: pipelineRepository() }).execute(
        pipelineVersionId,
      );
      return { ok: true, value: canvas } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function createPipelineNodeAction(
  input: CreatePipelineNodeInput,
): Promise<ActionResult<PipelineNodeRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.createPipelineNode");
        const result = await new CreatePipelineNode({
          pipelines: pipelineRepository(),
          agents: publishedAgentPort(),
        }).execute({ ...input, now: new Date() });
        if (!result.ok) return { ok: false, error: result.reason } as const;
        return { ok: true, value: result.node } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updatePipelineNodeAction(
  input: Omit<UpdatePipelineNodeInput, "now">,
): Promise<ActionResult<PipelineNodeRow>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.updatePipelineNode");
        const result = await new UpdatePipelineNode({
          pipelines: pipelineRepository(),
          agents: publishedAgentPort(),
        }).execute({ ...input, now: new Date() });
        if (!result.ok) return { ok: false, error: result.reason } as const;
        return { ok: true, value: result.node } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function deletePipelineNodeAction(
  id: string,
  pipelineVersionId: string,
): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.deletePipelineNode");
        await new DeletePipelineNode({ pipelines: pipelineRepository() }).execute(
          id,
          pipelineVersionId,
        );
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: { id, pipelineVersionId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function createPipelineEdgeAction(
  input: Omit<NewPipelineEdgeInput, "now">,
): Promise<ActionResult<CreatePipelineEdgeResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.createPipelineEdge");
        const result = await new CreatePipelineEdge({ pipelines: pipelineRepository() }).execute({
          ...input,
          now: new Date(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function updatePipelineEdgeAction(
  input: Omit<UpdatePipelineEdgeInput, "now">,
): Promise<ActionResult<UpdatePipelineEdgeResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.updatePipelineEdge");
        const result = await new UpdatePipelineEdge({ pipelines: pipelineRepository() }).execute({
          ...input,
          now: new Date(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function deletePipelineEdgeAction(
  id: string,
  pipelineVersionId: string,
): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.deletePipelineEdge");
        await new DeletePipelineEdge({ pipelines: pipelineRepository() }).execute(
          id,
          pipelineVersionId,
        );
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: { id, pipelineVersionId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function setPipelineEntryNodeAction(
  pipelineVersionId: string,
  nodeId: string,
): Promise<ActionResult<null>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.setPipelineEntryNode");
        await new SetPipelineEntryNode({ pipelines: pipelineRepository() }).execute(
          pipelineVersionId,
          nodeId,
          new Date(),
        );
        return { ok: true, value: null } as const;
      },
      { method: "POST", body: { pipelineVersionId, nodeId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function publishPipelineVersionAction(input: {
  readonly pipelineVersionId: string;
  readonly changeSummary: string | null;
}): Promise<ActionResult<PublishPipelineVersionResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.publishPipelineVersion");
        const result = await new PublishPipelineVersion({
          pipelines: pipelineRepository(),
          agents: publishedAgentPort(),
        }).execute({ ...input, actorStaffUserId: principal.id, now: new Date() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function setActivePipelineVersionAction(
  pipelineVersionId: string | null,
): Promise<ActionResult<SetActivePipelineVersionResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.setActivePipelineVersion");
        const result = await new SetActivePipelineVersion({
          routerConfig: routerConfigRepository(),
          pipelines: pipelineRepository(),
        }).execute({ pipelineVersionId, actorStaffUserId: principal.id, now: new Date() });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { pipelineVersionId } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function rollbackPipelineVersionAction(input: {
  readonly pipelineDesignId: string;
  readonly targetVersionId: string;
}): Promise<ActionResult<RollbackPipelineVersionResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.rollbackPipelineVersion");
        const result = await new RollbackPipelineVersion({ pipelines: pipelineRepository() }).execute({
          ...input,
          actorStaffUserId: principal.id,
          now: new Date(),
        });
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function getPipelineVersionHistoryAction(
  pipelineDesignId: string,
): Promise<ActionResult<readonly PipelineVersionHistoryEntryRow[]>> {
  try {
    return await withStaffAuth(async ({ principal }) => {
      requirePermission(principal, PERMISSION, "orchestrator.getPipelineVersionHistory");
      const rows = await new GetPipelineVersionHistory({ pipelines: pipelineRepository() }).execute(
        pipelineDesignId,
      );
      return { ok: true, value: rows } as const;
    });
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

/** Direct passthrough to `PipelineValidationClient` — no application-layer use case, the
 *  same "the real logic lives on the far side" shape `previewTraceAction` already
 *  establishes for the identical reason. */
export async function validatePipelineGraphAction(
  input: ValidatePipelineGraphInput,
): Promise<ActionResult<ValidatePipelineGraphResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.validatePipelineGraph");
        const result = await pipelineValidationClient().validateGraph(input);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: input },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export async function validatePipelineConditionAction(
  expression: string,
  knownNodeKeys: readonly string[],
): Promise<ActionResult<ValidatePipelineConditionResult>> {
  try {
    return await withStaffAuth(
      async ({ principal }) => {
        requirePermission(principal, PERMISSION, "orchestrator.validatePipelineCondition");
        const result = await pipelineValidationClient().validateCondition(expression, knownNodeKeys);
        return { ok: true, value: result } as const;
      },
      { method: "POST", body: { expression, knownNodeKeys } },
    );
  } catch (error) {
    return { ok: false, error: failureMessage(error) };
  }
}

export type { PipelineEdgeRow };
