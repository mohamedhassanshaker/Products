/**
 * The real `PipelineValidationClient` adapter — calls `apps/ai`'s `POST /v1/orchestration/
 * pipelines/validate` and `.../validate-condition` via `createTenantScopedAiClient()`, the
 * same "web holds no vendor driver" rule `ai-service-orchestration-preview-client.ts` (this
 * module's own sibling adapter) already follows. Shape-checked here rather than blind-cast,
 * matching that adapter's own precedent.
 */

import { createTenantScopedAiClient } from "../../../../platform/adapters/outbound/ai-client.js";
import type {
  PipelineValidationClient,
  PipelineValidationIssue,
  ValidatePipelineConditionResult,
  ValidatePipelineGraphInput,
  ValidatePipelineGraphResult,
} from "../../../ports/pipeline-validation-client.js";

function parseIssue(raw: unknown): PipelineValidationIssue | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as { code?: unknown; nodeKeys?: unknown; edgeKeys?: unknown; message?: unknown };
  if (
    typeof r.code !== "string" ||
    !Array.isArray(r.nodeKeys) ||
    !Array.isArray(r.edgeKeys) ||
    typeof r.message !== "string"
  ) {
    return null;
  }
  const nodeKeys: string[] = [];
  for (const k of r.nodeKeys) {
    if (typeof k !== "string") return null;
    nodeKeys.push(k);
  }
  const edgeKeys: string[] = [];
  for (const k of r.edgeKeys) {
    if (typeof k !== "string") return null;
    edgeKeys.push(k);
  }
  return { code: r.code, nodeKeys, edgeKeys, message: r.message };
}

function parseGraphResponse(body: unknown): ValidatePipelineGraphResult | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as { valid?: unknown; issues?: unknown };
  if (typeof r.valid !== "boolean" || !Array.isArray(r.issues)) return null;
  const issues: PipelineValidationIssue[] = [];
  for (const rawIssue of r.issues) {
    const issue = parseIssue(rawIssue);
    if (issue === null) return null;
    issues.push(issue);
  }
  return { valid: r.valid, issues };
}

function parseConditionResponse(body: unknown): ValidatePipelineConditionResult | null {
  if (typeof body !== "object" || body === null) return null;
  const r = body as { valid?: unknown; normalized?: unknown; issues?: unknown };
  if (
    typeof r.valid !== "boolean" ||
    (r.normalized !== null && typeof r.normalized !== "string") ||
    !Array.isArray(r.issues)
  ) {
    return null;
  }
  const issues: string[] = [];
  for (const i of r.issues) {
    if (typeof i !== "string") return null;
    issues.push(i);
  }
  return { valid: r.valid, normalized: r.normalized ?? null, issues };
}

export class AiServicePipelineValidationClient implements PipelineValidationClient {
  async validateGraph(input: ValidatePipelineGraphInput): Promise<ValidatePipelineGraphResult> {
    const client = createTenantScopedAiClient();
    const response = await client.post<unknown>("/orchestration/pipelines/validate", {
      entryNodeKey: input.entryNodeKey,
      nodes: input.nodes.map((n) => ({
        key: n.key,
        kind: n.kind,
        agentId: n.agentId,
        usesTurnBoundAgent: n.usesTurnBoundAgent,
        agentVersionPinId: n.agentVersionPinId,
        inputContextMode: n.inputContextMode,
        mergePolicyOverride: n.mergePolicyOverride,
        conflictResolutionOverride: n.conflictResolutionOverride,
        isOwningEntity: n.isOwningEntity,
        onErrorPolicy: n.onErrorPolicy,
      })),
      edges: input.edges.map((e) => ({
        fromNodeKey: e.fromNodeKey,
        toNodeKey: e.toNodeKey,
        kind: e.kind,
        ordinal: e.ordinal,
        maxIterations: e.maxIterations,
        conditionExpression: e.conditionExpression,
      })),
      maxTotalHops: input.maxTotalHops,
      costCeilingTokens: input.costCeilingTokens,
      costCeilingMicroAed: input.costCeilingMicroAed,
      defaultMergePolicy: input.defaultMergePolicy,
      defaultConflictResolution: input.defaultConflictResolution,
      publishedAgentIds: input.publishedAgentIds,
    });
    const parsed = parseGraphResponse(response);
    if (parsed === null) {
      throw new Error(
        "The AI service responded, but not with the documented pipelines/validate response shape.",
      );
    }
    return parsed;
  }

  async validateCondition(
    expression: string,
    knownNodeKeys: readonly string[],
  ): Promise<ValidatePipelineConditionResult> {
    const client = createTenantScopedAiClient();
    const response = await client.post<unknown>("/orchestration/pipelines/validate-condition", {
      expression,
      knownNodeKeys,
    });
    const parsed = parseConditionResponse(response);
    if (parsed === null) {
      throw new Error(
        "The AI service responded, but not with the documented validate-condition response shape.",
      );
    }
    return parsed;
  }
}
