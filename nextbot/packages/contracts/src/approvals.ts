import { Type, type Static } from "@sinclair/typebox";
import { DomainError } from "./errors.js";

/** LLD §6.1 — the 9-state approval-tier FSM. */
export const ToolCallStatus = Type.Union([
  Type.Literal("Created"),
  Type.Literal("PolicyDenied"),
  Type.Literal("AwaitingCustomerConfirmation"),
  Type.Literal("AwaitingHumanApproval"),
  Type.Literal("Executing"),
  Type.Literal("Succeeded"),
  Type.Literal("Failed"),
  Type.Literal("Cancelled"),
  Type.Literal("Expired"),
]);
export type ToolCallStatusValue = Static<typeof ToolCallStatus>;

/** `POST /api/v1/widget/tool-calls/{id}/confirm` (LLD §6.4, Tier 2). */
export const Tier2DecisionRequestSchema = Type.Object({
  decision: Type.Union([Type.Literal("Confirm"), Type.Literal("Cancel")]),
});
export type Tier2DecisionRequest = Static<typeof Tier2DecisionRequestSchema>;

/** `POST /api/v1/admin/approvals/{id}/decision` (LLD §6.5, Tier 3). `note` is
 * required on Reject/MoreInfoRequested (FR-ADM-04) — enforced in the application
 * layer, not the schema, since it's conditional on `decision`. */
export const Tier3DecisionRequestSchema = Type.Object({
  decision: Type.Union([Type.Literal("Approved"), Type.Literal("Rejected"), Type.Literal("MoreInfoRequested")]),
  note: Type.Optional(Type.String({ maxLength: 4000 })),
});
export type Tier3DecisionRequest = Static<typeof Tier3DecisionRequestSchema>;

export interface ApprovalQueueItemDto {
  id: string;
  toolCallId: string;
  conversationId: string;
  toolName: string;
  backendName: string | null;
  /** QA Final Review minor item (B.3.6's required "requested action" summary
   * column, an already-known incomplete fix) — a short human-readable
   * description of what's being requested, e.g. `"Call issue_refund"`. */
  actionSummary: string;
  channelType: string | null;
  requestedAt: string;
  waitSeconds: number;
  status: ToolCallStatusValue;
}

export interface ApprovalDetailDto extends ApprovalQueueItemDto {
  inputArgsMasked: Record<string, unknown> | null;
  riskSummary: Record<string, unknown>;
  transcriptExcerpt: Array<{ sender: string; text: string; at: string }>;
  recognizedGoal: string | null;
  customerIdentifier: string | null;
}

/** A tool call/approval already reached a terminal decision — a duplicate decision
 * attempt is rejected (though still logged, LLD §6.3) rather than silently re-applied. */
export class ApprovalAlreadyDecidedError extends DomainError {
  readonly code = "APPROVAL_ALREADY_DECIDED";
  readonly httpStatus = 409;
  constructor() {
    super("This approval has already been decided.");
  }
}

/** Tier-2/3 timeout elapsed with no decision (LLD §6.4/§6.5). */
export class ApprovalExpiredError extends DomainError {
  readonly code = "APPROVAL_EXPIRED";
  readonly httpStatus = 410;
  constructor() {
    super("This request has expired and can no longer be acted on.");
  }
}

/** A required decision note (Reject/MoreInfoRequested) was omitted (FR-ADM-04). */
export class ApprovalNoteRequiredError extends DomainError {
  readonly code = "VALIDATION_FAILED";
  readonly httpStatus = 422;
  constructor() {
    super("A note is required to reject or request more information.", [
      { path: "note", code: "VALIDATION_FAILED", message: "A note is required for this decision." },
    ]);
  }
}

export class ToolCallNotFoundError extends DomainError {
  readonly code = "TOOL_CALL_NOT_FOUND";
  readonly httpStatus = 404;
  constructor() {
    super("Tool call not found.");
  }
}
