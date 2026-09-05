import { findConversationIdsOlderThan, deleteConversationsByIds, redactRawPiiOlderThan } from "@nextbot/conversations";
import { redactToolCallPayloadsOlderThan, purgeToolCallMetadataOlderThan, deleteToolCallsByConversationIds } from "@nextbot/approvals";
import { deleteEscalationsByConversationIds } from "@nextbot/escalations";
import { computePurgeCutoff, getTenantDataPolicy, listActiveTenantContexts, markPurgeRun } from "@nextbot/tenancy";

/**
 * Phase 17 (BL-10, FR-ADM-06) — the retention-purge sweeper `docs/plans/
 * nextbot-plan.md`'s Phase 17 scope names. Per-tenant `tenant_data_policy` fields
 * are honored individually (`-1` = Indefinite means this tenant/category is never
 * purged).
 *
 * **QA fix (BE-2)**: all four `tenant_data_policy` retention categories are now
 * enforced, each independently gated on its own configured period:
 *  - `retention_transcripts_days` -> hard-deletes conversations/messages
 *    (`findConversationIdsOlderThan` + `deleteConversationsByIds`). **QA fix
 *    (Defect A)**: `tool_call`/`escalation` rows referencing an aged conversation
 *    have plain FKs with no `ON DELETE CASCADE`, so this orchestration deletes
 *    those referencing rows first (`deleteToolCallsByConversationIds`,
 *    `deleteEscalationsByConversationIds` — the same functions and FK-safe
 *    ordering already established for DSR Delete in
 *    `apps/web/src/lib/dsr-service.ts`) before deleting the conversation/message
 *    rows themselves. Previously this category called a single
 *    `deleteConversationsOlderThan` that skipped this step entirely and crashed
 *    with a foreign-key violation on any tenant with an aged conversation that
 *    still had a `tool_call`/`escalation` row pointing at it — a routine case,
 *    not an edge case, since Tier-1/2/3 tool calls and escalations are core
 *    product features.
 *  - `retention_tool_payloads_days` -> redacts `tool_call`'s payload-bearing
 *    columns in place (`redactToolCallPayloadsOlderThan`); the row and its
 *    metadata survive for the metadata category's own window.
 *  - `retention_tool_metadata_days` -> hard-deletes `tool_call` rows (and their
 *    `tool_call_event`/`approval_request` dependents) entirely
 *    (`purgeToolCallMetadataOlderThan`).
 *  - `retention_pii_days` -> redacts raw (unmasked) PII fields on conversations/
 *    messages in place (`redactRawPiiOlderThan`), independent of and typically
 *    shorter than the transcript category's own retention.
 *
 * See `packages/modules/approvals/src/infrastructure/tool-call-retention.ts` and
 * `packages/modules/conversations/src/infrastructure/conversation-repository.ts`'s
 * `redactRawPiiOlderThan` doc comments for the payload-vs-metadata-vs-PII category
 * split rationale (there is no separate "tool-call metadata" or "PII" table in this
 * schema — both are fields on existing rows, not distinct purge-able entities, so
 * "enforcement" for those two categories means field-level redaction rather than
 * row deletion).
 *
 * **Module boundary note**: the plan suggested this sweeper live inside
 * `packages/modules/audit`; `audit`'s LLD §2.3 allow-list is `["tenancy"]` only
 * (it cannot import `conversations`/`approvals`), so this orchestration lives in
 * `apps/worker` (composition root) instead — the only place these modules may be
 * imported together. Deviation is deliberate and documented here, not silent.
 */
export interface RetentionPurgeResult {
  tenantsChecked: number;
  tenantsPurged: number;
  conversationsDeleted: number;
  toolCallPayloadsRedacted: number;
  toolCallsPurged: number;
  piiFieldsRedacted: number;
}

export async function runRetentionPurgeSweep(): Promise<RetentionPurgeResult> {
  const tenants = await listActiveTenantContexts();
  let tenantsPurged = 0;
  let conversationsDeleted = 0;
  let toolCallPayloadsRedacted = 0;
  let toolCallsPurged = 0;
  let piiFieldsRedacted = 0;

  for (const ctx of tenants) {
    // QA fix (Defect A): one tenant's sweep failing (whether from an FK violation,
    // a transient DB error, or anything else unexpected) must not abort the whole
    // sweep tick for every other tenant still left in this loop. Each tenant's
    // iteration is isolated in its own try/catch — a failure is logged clearly for
    // operational follow-up and the sweep moves on to the next tenant. `markPurgeRun`
    // is intentionally left un-called for a tenant whose iteration throws, so the
    // same aged data is retried (rather than silently marked "done") on the next
    // hourly tick.
    try {
      const policy = await getTenantDataPolicy(ctx);
      if (!policy) continue;

      let tenantTouched = false;

      // Category 1: conversation transcripts.
      const transcriptsCutoff = computePurgeCutoff(policy.retentionTranscriptsDays);
      if (transcriptsCutoff !== null) {
        const conversationIds = await findConversationIdsOlderThan(ctx, transcriptsCutoff);
        if (conversationIds.length > 0) {
          // QA fix (Defect A): `tool_call`/`escalation` rows FK-reference
          // `conversation.id` with no `ON DELETE CASCADE`. Delete those referencing
          // rows first, in the same FK-safe order already established for DSR
          // Delete (`apps/web/src/lib/dsr-service.ts`), before removing the
          // conversation/message rows themselves — otherwise this throws a
          // foreign-key violation on any tenant with an aged conversation still
          // referenced by a tool_call/escalation row (a routine case, not an edge
          // case).
          await deleteToolCallsByConversationIds(ctx, conversationIds);
          await deleteEscalationsByConversationIds(ctx, conversationIds);
          const deleted = await deleteConversationsByIds(ctx, conversationIds);
          if (deleted > 0) {
            conversationsDeleted += deleted;
            tenantTouched = true;
          }
        }
      }

      // Category 2: tool-call payloads.
      const toolPayloadsCutoff = computePurgeCutoff(policy.retentionToolPayloadsDays);
      if (toolPayloadsCutoff !== null) {
        const redacted = await redactToolCallPayloadsOlderThan(ctx, toolPayloadsCutoff);
        if (redacted > 0) {
          toolCallPayloadsRedacted += redacted;
          tenantTouched = true;
        }
      }

      // Category 3: tool-call metadata (the tool_call row + dependents themselves).
      const toolMetadataCutoff = computePurgeCutoff(policy.retentionToolMetadataDays);
      if (toolMetadataCutoff !== null) {
        const purged = await purgeToolCallMetadataOlderThan(ctx, toolMetadataCutoff);
        if (purged > 0) {
          toolCallsPurged += purged;
          tenantTouched = true;
        }
      }

      // Category 4: PII (raw/unmasked fields, independent of transcript retention).
      const piiCutoff = computePurgeCutoff(policy.retentionPiiDays);
      if (piiCutoff !== null) {
        const redacted = await redactRawPiiOlderThan(ctx, piiCutoff);
        if (redacted > 0) {
          piiFieldsRedacted += redacted;
          tenantTouched = true;
        }
      }

      if (tenantTouched) tenantsPurged += 1;
      await markPurgeRun(ctx);
    } catch (err) {
      // Logged clearly (not silently swallowed) so a crashing tenant is visible for
      // operational follow-up, matching `apps/worker/src/scheduler.ts`'s existing
      // job-failure logging convention.
      console.error(`NextBot worker: retention-purge sweep failed for tenant "${ctx.tenantId}"`, err);
    }
  }

  return {
    tenantsChecked: tenants.length,
    tenantsPurged,
    conversationsDeleted,
    toolCallPayloadsRedacted,
    toolCallsPurged,
    piiFieldsRedacted,
  };
}
