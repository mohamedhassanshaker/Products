/**
 * Calls `apps/ai`'s `POST /v1/orchestration/pipelines/validate` and `.../validate-condition`
 * (`orchestration_preview_router.py`) — the SAME rule set `domain/pipeline.py::
 * validate_definition`/`domain/condition_expr.py` enforce at execution time, and the same
 * rule set `TR_PipelineVersions_publishGraphValid` enforces at publish time. The web canvas
 * runs `analyzePipelineGraph`/`pipeline-condition.ts`'s own `validate` client-side for
 * instant feedback while a Draft is being edited; this client is the server-checked answer
 * `PublishPipelineVersion`/the publish button's own gate calls before ever writing —
 * "the canvas says this is fine" and "the server accepted it" must never quietly disagree,
 * the third of the three deliberately-mirrored implementations this whole feature's design
 * insists on (SQL trigger, Python, TypeScript).
 */

export interface ValidatePipelineGraphNodeInput {
  readonly key: string;
  readonly kind: string;
  readonly agentId: string | null;
  readonly usesTurnBoundAgent: boolean;
  readonly agentVersionPinId: string | null;
  readonly inputContextMode: string;
  readonly mergePolicyOverride: string | null;
  readonly conflictResolutionOverride: string | null;
  readonly isOwningEntity: boolean;
  readonly onErrorPolicy: string;
}

export interface ValidatePipelineGraphEdgeInput {
  readonly fromNodeKey: string;
  readonly toNodeKey: string;
  readonly kind: string;
  readonly ordinal: number;
  readonly maxIterations: number | null;
  readonly conditionExpression: string | null;
}

export interface ValidatePipelineGraphInput {
  readonly entryNodeKey: string;
  readonly nodes: readonly ValidatePipelineGraphNodeInput[];
  readonly edges: readonly ValidatePipelineGraphEdgeInput[];
  readonly maxTotalHops: number;
  readonly costCeilingTokens: number;
  readonly costCeilingMicroAed: number;
  readonly defaultMergePolicy: string;
  readonly defaultConflictResolution: string;
  readonly publishedAgentIds: readonly string[];
}

export interface PipelineValidationIssue {
  readonly code: string;
  readonly nodeKeys: readonly string[];
  readonly edgeKeys: readonly string[];
  readonly message: string;
}

export interface ValidatePipelineGraphResult {
  readonly valid: boolean;
  readonly issues: readonly PipelineValidationIssue[];
}

export interface ValidatePipelineConditionResult {
  readonly valid: boolean;
  readonly normalized: string | null;
  readonly issues: readonly string[];
}

export interface PipelineValidationClient {
  validateGraph(input: ValidatePipelineGraphInput): Promise<ValidatePipelineGraphResult>;
  validateCondition(
    expression: string,
    knownNodeKeys: readonly string[],
  ): Promise<ValidatePipelineConditionResult>;
}
