/**
 * B7 flow-node domain — the five typed node kinds a `FlowVersion`'s canvas is built from,
 * and the completeness rules each kind must satisfy.
 *
 * Every closed set and every completeness rule here is a literal transcription of a real
 * constraint in `prisma/sql/001_constraints.sql` (`CK_FlowNodes_type`, `_messageFields`,
 * `_questionFields`, `_toolCallFields`, `_handoverFields`, `_conditionFields`,
 * `_retryBounded`, `_optionSourceKind`, `_requiredAssurance`) — verified against that file
 * directly, not reconstructed from a design doc (`tasks/lessons.md`'s "string-literal
 * vocabularies must match real CHECK constraints exactly" lesson). Validating here BEFORE
 * the repository issues the INSERT/UPDATE turns an opaque SQL Server constraint-violation
 * error into a clean, field-attributed message — but the real constraint remains the final
 * backstop; this module does not trust its own validation to be exhaustive.
 *
 * `RequiredAssuranceLevel` is deliberately re-declared here rather than imported from
 * `modules/tools/domain/tool-catalog.ts`: `eslint.config.mjs`'s `boundaries/element-types`
 * rule forbids one feature module importing another (architecture.md §3) — the same
 * boundary `prisma-agent-repository.ts`'s own module comment documents working around for
 * `ToolBindings`. The four-value closed set is small and stable (both sides share the same
 * real column, `FlowNodes.requiredAssurance` / `ToolBindings.requiredAssurance`, both
 * constrained by the identical `CK_*_requiredAssurance` shape) — a short, duplicated literal
 * union costs far less than a forced cross-module dependency.
 */

export const FLOW_NODE_TYPES = [
  "Message",
  "Question",
  "ToolCall",
  "Handover",
  "Condition",
] as const;
export type FlowNodeType = (typeof FLOW_NODE_TYPES)[number];
export function isFlowNodeType(value: string): value is FlowNodeType {
  return (FLOW_NODE_TYPES as readonly string[]).includes(value);
}

export const OPTION_SOURCE_KINDS = ["Static", "GraphEntityLabel", "ToolResult"] as const;
export type OptionSourceKind = (typeof OPTION_SOURCE_KINDS)[number];
export function isOptionSourceKind(value: string): value is OptionSourceKind {
  return (OPTION_SOURCE_KINDS as readonly string[]).includes(value);
}

/** `CK_FlowNodes_handoverFields` — a narrower set than `EscalationTickets.reason`: `UserRequest` is the third value no flow node produces, because it comes from the citizen (schema's own doc comment). */
export const FLOW_NODE_HANDOVER_REASONS = ["ToolFailure", "LowConfidence"] as const;
export type FlowNodeHandoverReason = (typeof FLOW_NODE_HANDOVER_REASONS)[number];
export function isFlowNodeHandoverReason(value: string): value is FlowNodeHandoverReason {
  return (FLOW_NODE_HANDOVER_REASONS as readonly string[]).includes(value);
}

export const FLOW_REQUIRED_ASSURANCE_LEVELS = [
  "Anonymous",
  "Verified",
  "VerifiedPlusOtp",
  "VerifiedPlusDocument",
] as const;
export type FlowRequiredAssuranceLevel = (typeof FLOW_REQUIRED_ASSURANCE_LEVELS)[number];
export function isFlowRequiredAssuranceLevel(value: string): value is FlowRequiredAssuranceLevel {
  return (FLOW_REQUIRED_ASSURANCE_LEVELS as readonly string[]).includes(value);
}

/** Every column a `FlowNode` row carries, real fields only — no UI-only concepts. */
export interface FlowNodeFields {
  readonly type: FlowNodeType;
  readonly title: string;
  readonly canvasX: number;
  readonly canvasY: number;
  readonly messageText: string | null;
  readonly quickActionSetKey: string | null;
  readonly slotName: string | null;
  readonly optionSourceKind: OptionSourceKind | null;
  readonly optionSourceRef: string | null;
  readonly staticOptionsJson: string | null;
  readonly toolBindingId: string | null;
  readonly retryCount: number | null;
  readonly retryOnTimeout: boolean | null;
  readonly timeoutMs: number | null;
  readonly onFailureNodeId: string | null;
  readonly handoverReason: FlowNodeHandoverReason | null;
  readonly confidenceThreshold: number | null;
  readonly conditionExpression: string | null;
  readonly requiredAssurance: FlowRequiredAssuranceLevel | null;
}

/**
 * Mirrors every `CK_FlowNodes_*` field-completeness rule, field by field, in the same order
 * as `001_constraints.sql` declares them. Returns one message per violated rule (empty =
 * valid) rather than a single boolean, so a caller (a Server Action, a form) can attribute
 * each error to the field that caused it.
 */
export function validateFlowNodeFields(fields: FlowNodeFields): readonly string[] {
  const errors: string[] = [];

  if (fields.title.trim() === "") {
    errors.push("A node needs a title.");
  }

  // CK_FlowNodes_messageFields
  if (
    fields.type === "Message" &&
    (fields.messageText === null || fields.messageText.trim() === "")
  ) {
    errors.push("A Message node needs message text.");
  }

  // CK_FlowNodes_questionFields
  if (fields.type === "Question") {
    if (fields.slotName === null || fields.slotName.trim() === "") {
      errors.push("A Question node needs a slot name.");
    }
    if (fields.optionSourceKind === null) {
      errors.push("A Question node needs an option source.");
    }
  }

  // CK_FlowNodes_toolCallFields — B7's retry contract: a tool-call node with no failure
  // target is a node whose failure path is undefined.
  if (fields.type === "ToolCall") {
    if (fields.toolBindingId === null) errors.push("A Tool call node needs a bound tool.");
    if (fields.retryCount === null) errors.push("A Tool call node needs a retry count.");
    if (fields.onFailureNodeId === null) {
      errors.push("A Tool call node needs a failure path (which node to move to on failure).");
    }
  }

  // CK_FlowNodes_retryBounded
  if (fields.retryCount !== null && (fields.retryCount < 0 || fields.retryCount > 3)) {
    errors.push("Retry count must be between 0 and 3.");
  }

  // CK_FlowNodes_handoverFields
  if (fields.type === "Handover" && fields.handoverReason === null) {
    errors.push("A Handover node needs a reason (Tool failure or Low confidence).");
  }

  // CK_FlowNodes_conditionFields
  if (
    fields.type === "Condition" &&
    (fields.conditionExpression === null || fields.conditionExpression.trim() === "")
  ) {
    errors.push("A Condition node needs a condition expression.");
  }

  // CK_FlowNodes_staticOptionsJson_isJson
  if (fields.staticOptionsJson !== null) {
    try {
      JSON.parse(fields.staticOptionsJson);
    } catch {
      errors.push("Static options must be valid JSON.");
    }
  }

  return errors;
}

/** A short, one-line summary of a node's real configuration — what the authoring list shows under the title, per type. */
export function summarizeFlowNode(fields: FlowNodeFields): string {
  switch (fields.type) {
    case "Message":
      return fields.messageText ?? "";
    case "Question":
      return fields.slotName ? `Saves answer as "${fields.slotName}"` : "";
    case "ToolCall":
      return fields.retryCount !== null ? `Retries ${fields.retryCount}x on failure` : "";
    case "Handover":
      return fields.handoverReason ?? "";
    case "Condition":
      return fields.conditionExpression ?? "";
  }
}
