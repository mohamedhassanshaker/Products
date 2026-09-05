import "server-only";
import { recordAuditEntry } from "@nextbot/audit";
import type { TenantContext } from "@nextbot/db";

/**
 * QA Final Review B4 — `recordAuditEntry` was called from exactly one place in the
 * whole codebase (the DSR delete flow); every other human-initiated action
 * (connector/permission-rule CRUD, Tier-3 approval decisions, escalation
 * claim/takeover, login) produced zero audit rows, defeating FR-ADM-03's "who did
 * this" requirement. `packages/modules/**` can't import `@nextbot/audit`
 * themselves (LLD §2.3's allow-list has no such edge for any of the modules this
 * fix touches) — `apps/web` is the composition root that already owns this
 * responsibility (see `dsr-service.ts`'s own pre-existing direct call), so every
 * new call site added by this fix pass lives here too, in the API route/Server
 * Action layer, immediately after the underlying module call succeeds/fails.
 *
 * A best-effort wrapper: an audit-write failure must never fail (or roll back) the
 * action it's describing — it's logged server-side and swallowed, the same
 * fail-safe posture this project already requires of its file-logging sink.
 */
export async function recordAdminAudit(
  ctx: TenantContext,
  input: {
    actorId: string | null;
    actorLabel: string;
    actionType: string;
    targetType?: string | null;
    targetId?: string | null;
    outcome: "Success" | "Failure" | "Denied";
    details?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await recordAuditEntry(ctx, {
      actorId: input.actorId,
      actorLabel: input.actorLabel,
      actionType: input.actionType,
      targetType: input.targetType ?? null,
      targetId: input.targetId ?? null,
      outcome: input.outcome,
      details: input.details ?? {},
    });
  } catch (err) {
    console.error("recordAdminAudit: failed to write audit entry (action not rolled back)", err);
  }
}
