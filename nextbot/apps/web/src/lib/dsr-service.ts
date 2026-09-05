import "server-only";
import {
  completeDsrRequest,
  createDsrRequest,
  detectAndMask,
  buildPolicyLookup,
  maskJsonValue,
  type DsrType,
} from "@nextbot/pii";
import {
  deleteConversationsByCustomerIdentifier,
  findConversationsByCustomerIdentifier,
  listMessagesSince,
  type ConversationRow,
  type MessageRow,
} from "@nextbot/conversations";
import {
  findToolCallsByConversationIds,
  deleteToolCallsByConversationIds,
  type ToolCallRow,
} from "@nextbot/approvals";
import {
  findEscalationsByConversationIds,
  deleteEscalationsByConversationIds,
  type EscalationRow,
} from "@nextbot/escalations";
import { recordAuditEntry, findAuditEntriesForTargets, type AuditLogEntryRow } from "@nextbot/audit";
import type { TenantContext } from "@nextbot/db";

/**
 * Phase 17 (BL-10, B.8.4) — the GDPR-style "Process Data Subject Request" tool's
 * composition-root orchestration. Lives here (not inside `pii`) because it needs
 * `conversations`/`approvals`/`escalations`/`audit` too, and `pii`'s LLD §2.3
 * allow-list is `["tenancy"]` only — exactly the same "only an app may import
 * both" seam `turn-pipeline-adapter.ts` documents for `orchestration`/
 * `escalations`.
 *
 * Every DSR action is itself audited directly (`recordAuditEntry`) — a data-subject
 * request is inherently security/compliance-sensitive and must not depend on the
 * best-effort outbox-consumer path's normal latency.
 *
 * **QA fix (BE-3, FR-ADM-06)**: FR-ADM-06 requires "search/view/export/delete...
 * across all of a tenant's data" for a customer identifier — unconditional scope,
 * not just conversation-row metadata. `aggregateCustomerData` below is now the
 * single, shared aggregation both Search/Export (view) and Delete (removal) build
 * on: conversation records, every message/transcript, escalation records, tool-call
 * records tied to those conversations, and the customer's own audit trail.
 */
export interface CustomerDataAggregate {
  conversations: ConversationRow[];
  messages: MessageRow[];
  escalations: EscalationRow[];
  toolCalls: ToolCallRow[];
  auditEntries: AuditLogEntryRow[];
}

export interface DsrOutcome {
  conversationsFound: number;
  messagesFound: number;
  escalationsFound: number;
  toolCallsFound: number;
  auditEntriesFound: number;
  conversationsDeleted?: number;
  toolCallsDeleted?: number;
  escalationsDeleted?: number;
  /** Present for Search/Export only — the actual matching records (per FR-ADM-06's
   * explicit three-distinct-actions design: an admin must be able to *view* a
   * customer's data, not just get a count, before deciding to export/delete it). */
  data?: CustomerDataAggregate;
}

/**
 * Aggregates every piece of `ctx.tenantId`'s data tied to `customerIdentifier`,
 * across every module FR-ADM-06 names: conversations (+ their messages),
 * escalations, tool calls, and the customer's own audit-trail entries (matched
 * by the same masked-identifier `targetId` `recordAuditEntry` writes below, plus
 * every tool-call id found for this customer's conversations).
 */
export async function aggregateCustomerData(ctx: TenantContext, customerIdentifier: string): Promise<CustomerDataAggregate> {
  const conversations = await findConversationsByCustomerIdentifier(ctx, customerIdentifier);
  const conversationIds = conversations.map((c) => c.id);

  const [messagesByConversation, escalations, toolCalls] = await Promise.all([
    Promise.all(conversationIds.map((id) => listMessagesSince(ctx, id, 0))),
    findEscalationsByConversationIds(ctx, conversationIds),
    findToolCallsByConversationIds(ctx, conversationIds),
  ]);
  const messages = messagesByConversation.flat();

  const maskedIdentifier = detectAndMask(customerIdentifier, "Export", "Untrusted", () => "PartialMask");
  const auditTargets = [
    { targetType: "customer", targetId: maskedIdentifier },
    ...toolCalls.map((tc) => ({ targetType: "tool_call", targetId: tc.id })),
  ];
  const auditEntries = await findAuditEntriesForTargets(ctx, auditTargets);

  return { conversations, messages, escalations, toolCalls, auditEntries };
}

export async function processDsrRequest(
  ctx: TenantContext,
  requestType: DsrType,
  customerIdentifier: string,
  requestedByUserId: string | null,
): Promise<{ requestId: string; outcome: DsrOutcome }> {
  const requestId = await createDsrRequest(ctx, { requestType, customerIdentifier, requestedByUserId });

  try {
    const aggregate = await aggregateCustomerData(ctx, customerIdentifier);
    const counts = {
      conversationsFound: aggregate.conversations.length,
      messagesFound: aggregate.messages.length,
      escalationsFound: aggregate.escalations.length,
      toolCallsFound: aggregate.toolCalls.length,
      auditEntriesFound: aggregate.auditEntries.length,
    };
    let outcome: DsrOutcome = { ...counts };

    if (requestType === "Delete") {
      // FK-safe deletion order: children (tool_call/escalation) before the
      // conversation/message rows they reference — see `deleteToolCallsByConversationIds`
      // and `deleteEscalationsByConversationIds`'s doc comments for why this was a
      // real, previously-uncaught gap (no ON DELETE CASCADE on either FK).
      const conversationIds = aggregate.conversations.map((c) => c.id);
      const toolCallsDeleted = await deleteToolCallsByConversationIds(ctx, conversationIds);
      const escalationsDeleted = await deleteEscalationsByConversationIds(ctx, conversationIds);
      const conversationsDeleted = await deleteConversationsByCustomerIdentifier(ctx, customerIdentifier);
      outcome = { ...outcome, conversationsDeleted, toolCallsDeleted, escalationsDeleted };
    } else {
      // Search/Export: return the actual aggregated records (UI-D3) — never
      // persisted (see `resultSummary`'s doc below), only handed back to the
      // requester's response.
      outcome = { ...outcome, data: aggregate };
    }

    // Only non-sensitive counts are persisted in `resultSummary` — never the raw
    // aggregated records themselves (this module's long-standing convention, now
    // explicitly enforced by stripping `data` before persisting).
    const { data, ...persistedSummary } = outcome;
    void data; // stripped intentionally — see comment above.
    await completeDsrRequest(ctx, requestId, { status: "Completed", resultSummary: persistedSummary as unknown as Record<string, unknown> });

    await recordAuditEntry(ctx, {
      actorId: requestedByUserId,
      actorLabel: requestedByUserId ?? "system",
      actionType: `dsr.${requestType.toLowerCase()}`,
      targetType: "customer",
      // The customer identifier itself is PII — masked before it ever reaches the
      // audit trail, exactly like any other PII-bearing field (FR-SEC-04).
      targetId: detectAndMask(customerIdentifier, "Export", "Untrusted", () => "PartialMask"),
      outcome: "Success",
      details: persistedSummary as unknown as Record<string, unknown>,
    });
    return { requestId, outcome };
  } catch (err) {
    await completeDsrRequest(ctx, requestId, { status: "Failed", resultSummary: { error: err instanceof Error ? err.message : String(err) } });
    throw err;
  }
}

/**
 * DSR "Export": returns every matched record across every FR-ADM-06-named data
 * category for the requester to download — never persisted server-side beyond
 * the `data_subject_request` summary (row counts only), per this module's own
 * doc above. `details` on any included audit entries is masked the same way the
 * Audit Log Viewer's own masked read path (`queryMaskedAuditLog`) masks it — an
 * export is exactly the kind of artifact that leaves the admin session's
 * control, so it must never carry unmasked PII either.
 */
export async function exportDsrData(ctx: TenantContext, customerIdentifier: string): Promise<CustomerDataAggregate> {
  const aggregate = await aggregateCustomerData(ctx, customerIdentifier);
  const resolvePolicy = await buildPolicyLookup(ctx);
  return {
    ...aggregate,
    auditEntries: aggregate.auditEntries.map((entry) => ({
      ...entry,
      details: maskJsonValue(entry.details, "Export", "Untrusted", resolvePolicy) as Record<string, unknown>,
    })),
  };
}
