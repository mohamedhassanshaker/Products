import { Type, type Static } from "@sinclair/typebox";
import { CitationSchema } from "./knowledge.js";

/**
 * `MessageContentType` — LLD §3.7: "the 14 FR-AI-04 types + `Error`" (15 total). The
 * Postgres enum and this literal union carry all 15 from day one so the column never
 * needs an `ALTER TYPE ... ADD VALUE` migration later (cheap, forward-compatible);
 * only the 5 named below have a concrete TypeBox payload schema and a code path that
 * can actually produce them this phase (BL-04's stated core set: Text/QuickReply/
 * List/Form, plus `Error` for FR-AI-05's fallback bubble — explicitly requested
 * alongside the core set for Phase 8's widget UI). The remaining 9
 * (ExternalLink/Document/DataSummary/DataTable/OTP/Confirmation/TicketCreated/
 * TicketStatus/FileUpload) are added incrementally as the backlog items that need
 * them land (Phase 12 for the MCP-result-rendering set, per the plan).
 */
export const MessageContentTypeSchema = Type.Union([
  Type.Literal("Text"),
  Type.Literal("QuickReply"),
  Type.Literal("List"),
  Type.Literal("ExternalLink"),
  Type.Literal("Document"),
  Type.Literal("DataSummary"),
  Type.Literal("DataTable"),
  Type.Literal("Form"),
  Type.Literal("OTP"),
  Type.Literal("Confirmation"),
  Type.Literal("TicketCreated"),
  Type.Literal("TicketStatus"),
  Type.Literal("FileUpload"),
  Type.Literal("Error"),
]);
export type MessageContentTypeValue = Static<typeof MessageContentTypeSchema>;

/** Content types this phase can actually validate/persist/render (see module doc above).
 * Phase 12 (BL-05) adds the four MCP-result-rendering types. */
export const IMPLEMENTED_MESSAGE_CONTENT_TYPES = [
  "Text",
  "QuickReply",
  "List",
  "Form",
  "Error",
  "DataSummary",
  "DataTable",
  "Document",
  "ExternalLink",
  "Confirmation",
] as const;

export const MessageSenderSchema = Type.Union([
  Type.Literal("Customer"),
  Type.Literal("AI"),
  Type.Literal("HumanAgent"),
  Type.Literal("System"),
]);
export type MessageSenderValue = Static<typeof MessageSenderSchema>;

// ---------------------------------------------------------------------------
// A.2.1 — Text Message Bubble (FR-AI-04)
// ---------------------------------------------------------------------------
export const TextPayloadSchema = Type.Object({
  contentType: Type.Literal("Text"),
  text: Type.String({ minLength: 1, maxLength: 8000 }),
  /** Markdown-lite: bold/links/line-breaks only, per the screen inventory's A.2.1 note. */
  markdown: Type.Optional(Type.Boolean()),
  /**
   * Target Architecture Blueprint Phase 10 (BL-41, FR-KB-07, LLD §14.4.4's closing
   * note) — "citations ride on the existing Text payload as `citations?: Citation[]`,
   * so every channel adapter degrades them per §8 without new per-channel code."
   * Present only on a `Grounded`/`Ungrounded` bounded-retrieval-agent reply; absent on
   * every ordinary Text message (canned reply, human-agent message, etc.) — never a
   * silent structural change to any pre-existing Text message.
   */
  citations: Type.Optional(Type.Array(CitationSchema)),
});
export type TextPayload = Static<typeof TextPayloadSchema>;

// ---------------------------------------------------------------------------
// A.2.2 — Quick Reply Chips (FR-AI-04)
// ---------------------------------------------------------------------------
export const QuickReplyPayloadSchema = Type.Object({
  contentType: Type.Literal("QuickReply"),
  text: Type.Optional(Type.String({ maxLength: 8000 })),
  chips: Type.Array(
    Type.Object({
      id: Type.String(),
      label: Type.String({ minLength: 1, maxLength: 200 }),
    }),
    { minItems: 1 },
  ),
  /** Single-use: once a chip is tapped the row disables (A.2.2 behavior note). Set by
   * the client on the reply message it sends back, referencing the chip id. */
  selectedChipId: Type.Optional(Type.String()),
});
export type QuickReplyPayload = Static<typeof QuickReplyPayloadSchema>;

// ---------------------------------------------------------------------------
// A.2.3 — Interactive List / Picker (FR-AI-04)
// ---------------------------------------------------------------------------
export const ListPayloadSchema = Type.Object({
  contentType: Type.Literal("List"),
  title: Type.Optional(Type.String()),
  items: Type.Array(
    Type.Object({
      id: Type.String(),
      label: Type.String({ minLength: 1 }),
      subtitle: Type.Optional(Type.String()),
      icon: Type.Optional(Type.String()),
    }),
    { minItems: 1 },
  ),
  /** A.2.3: search bar shown when the list has more than 8 items — computed
   * client-side from `items.length`, not persisted. */
  selectedItemId: Type.Optional(Type.String()),
});
export type ListPayload = Static<typeof ListPayloadSchema>;

// ---------------------------------------------------------------------------
// A.2.8 — Form Collection Card, multi-field (FR-AI-01, FR-AI-04)
// ---------------------------------------------------------------------------
export const FormFieldSchema = Type.Object({
  name: Type.String({ minLength: 1 }),
  label: Type.String({ minLength: 1 }),
  type: Type.Union([
    Type.Literal("text"),
    Type.Literal("email"),
    Type.Literal("phone"),
    Type.Literal("select"),
    Type.Literal("textarea"),
    Type.Literal("file"),
  ]),
  required: Type.Optional(Type.Boolean()),
  options: Type.Optional(Type.Array(Type.Object({ value: Type.String(), label: Type.String() }))),
  /** FR-AI-01 parameter-validation hint (regex/enum/date/number/phone/email/national-ID
   * pattern) applied to the *extracted* value; a failing value produces a targeted
   * re-prompt naming the field, not a generic "invalid input" message. */
  pattern: Type.Optional(Type.String()),
});

export const FormPayloadSchema = Type.Object({
  contentType: Type.Literal("Form"),
  title: Type.Optional(Type.String()),
  fields: Type.Array(FormFieldSchema, { minItems: 1 }),
  submitLabel: Type.String({ default: "Submit" }),
  /** Present on the customer's reply message: field name -> submitted value. */
  values: Type.Optional(Type.Record(Type.String(), Type.String())),
});
export type FormPayload = Static<typeof FormPayloadSchema>;

// ---------------------------------------------------------------------------
// A.2.15 — Error / Fallback Message (FR-AI-05)
// ---------------------------------------------------------------------------
export const ErrorPayloadSchema = Type.Object({
  contentType: Type.Literal("Error"),
  /** Which of FR-AI-05's three fixed fallback classes this is — drives which of the
   * three exact copy strings the widget renders (never a generic message). */
  reason: Type.Union([
    Type.Literal("BackendTimeout"),
    Type.Literal("GoalNotUnderstood"),
    Type.Literal("ToolCallFailure"),
    /** Target Architecture Blueprint Phase 10 (BL-41, FR-KB-06, LLD §14.4.4 step 6) —
     *  a FOURTH fallback class, distinct from the original three: the bounded
     *  retrieval agent's `refuseWhenUngrounded` runtime check fired (fewer than
     *  `minCitations` structured citations survived), so the turn refuses rather
     *  than answer without grounding. */
    Type.Literal("KnowledgeNotGrounded"),
  ]),
  text: Type.String(),
  /** FR-AI-05: goal-not-understood re-prompts with quick-reply chip options. */
  chips: Type.Optional(Type.Array(Type.Object({ id: Type.String(), label: Type.String() }))),
});
export type ErrorPayload = Static<typeof ErrorPayloadSchema>;

// ---------------------------------------------------------------------------
// Phase 12 (BL-05) — MCP tool-result rendering payloads (FR-MCP-07)
// ---------------------------------------------------------------------------

/** A.2.x Data Summary Card — a small set of labeled key/value facts (e.g. an order
 * status lookup). Distinct from `DataTable` (tabular/multi-row results). */
export const DataSummaryPayloadSchema = Type.Object({
  contentType: Type.Literal("DataSummary"),
  title: Type.Optional(Type.String()),
  fields: Type.Array(
    Type.Object({
      label: Type.String({ minLength: 1 }),
      value: Type.String(),
    }),
    { minItems: 1 },
  ),
});
export type DataSummaryPayload = Static<typeof DataSummaryPayloadSchema>;

/** A.2.x Data Table Card — tabular MCP tool output, rendered as a scrollable table. */
export const DataTablePayloadSchema = Type.Object({
  contentType: Type.Literal("DataTable"),
  title: Type.Optional(Type.String()),
  columns: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
  rows: Type.Array(Type.Array(Type.String())),
});
export type DataTablePayload = Static<typeof DataTablePayloadSchema>;

/** A.2.x Document Card — a link to a generated/fetched document (invoice, report). */
export const DocumentPayloadSchema = Type.Object({
  contentType: Type.Literal("Document"),
  title: Type.String({ minLength: 1 }),
  url: Type.String({ minLength: 1 }),
  mimeType: Type.Optional(Type.String()),
  sizeBytes: Type.Optional(Type.Number()),
});
export type DocumentPayload = Static<typeof DocumentPayloadSchema>;

/** A.2.x External Link Card — a plain outbound link with optional preview text. */
export const ExternalLinkPayloadSchema = Type.Object({
  contentType: Type.Literal("ExternalLink"),
  title: Type.String({ minLength: 1 }),
  url: Type.String({ minLength: 1 }),
  description: Type.Optional(Type.String()),
});
export type ExternalLinkPayload = Static<typeof ExternalLinkPayloadSchema>;

// ---------------------------------------------------------------------------
// A.2.10 — Confirmation / Action Card (FR-MCP-05 Tier 2), Phase 14 (BL-08)
// ---------------------------------------------------------------------------
/** Rendered whenever a write tool call resolves to Tier-2 (customer confirmation).
 * `summary` is dynamically populated from the tool call's extracted args (never a
 * raw args dump) so the customer sees what they're being asked to confirm in plain
 * language. `state` is the one field this system mutates in place on decision (LLD
 * §6.4) — the pre-mutation `pending` value is always recoverable from `tool_call_event`. */
export const ConfirmationPayloadSchema = Type.Object({
  contentType: Type.Literal("Confirmation"),
  toolCallId: Type.String({ minLength: 1 }),
  title: Type.String({ minLength: 1 }),
  summary: Type.Array(Type.Object({ label: Type.String({ minLength: 1 }), value: Type.String() })),
  disclaimer: Type.Optional(Type.String()),
  state: Type.Union([
    Type.Literal("pending"),
    Type.Literal("confirmed"),
    Type.Literal("cancelled"),
    Type.Literal("expired"),
  ]),
});
export type ConfirmationPayload = Static<typeof ConfirmationPayloadSchema>;

/**
 * The discriminated union of every payload this phase can validate. `Type.Union`
 * (not a keyed record) so `Value.Check` can be used directly against an inbound
 * request body the way every other contracts schema in this package is validated.
 */
export const MessagePayloadSchema = Type.Union([
  TextPayloadSchema,
  QuickReplyPayloadSchema,
  ListPayloadSchema,
  FormPayloadSchema,
  ErrorPayloadSchema,
  DataSummaryPayloadSchema,
  DataTablePayloadSchema,
  DocumentPayloadSchema,
  ExternalLinkPayloadSchema,
  ConfirmationPayloadSchema,
]);
export type MessagePayload = Static<typeof MessagePayloadSchema>;
