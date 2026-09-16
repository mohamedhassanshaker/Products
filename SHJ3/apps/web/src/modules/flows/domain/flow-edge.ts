/**
 * B7 flow-edge domain — a directed connection between two nodes in the same `FlowVersion`.
 *
 * `CK_FlowEdges_noSelfLoop` (`prisma/sql/001_constraints.sql`) is the one rule cheap enough
 * to pre-validate here; `UQ_FlowEdges_defaultBranch` (at most one default branch per
 * `(flowVersionId, fromNodeId)`) and `TR_FlowEdges_sameVersion` (both endpoints must belong
 * to the same version) are left to the real constraint/trigger — pre-checking either would
 * mean re-deriving the exact same set the repository already has to query to perform the
 * write, at which point the check is just the write with extra steps. Their real rejections
 * are translated by the adapter instead (matches `tool-binding-repository.ts`'s own
 * substring-match precedent for a trigger it cannot pre-validate more cheaply either).
 */

export interface FlowEdgeFields {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly label: string | null;
  readonly ordinal: number;
  readonly conditionExpression: string | null;
  readonly isDefaultBranch: boolean;
}

export function validateFlowEdgeFields(fields: FlowEdgeFields): readonly string[] {
  const errors: string[] = [];
  if (fields.fromNodeId === fields.toNodeId) {
    errors.push("A connection cannot point a node back at itself.");
  }
  return errors;
}
