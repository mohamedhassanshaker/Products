import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";
import type { PermissionIntersectionResult } from "@nextbot/contracts";
import { evaluate } from "../domain/intersect.js";
import { hashScopeInput } from "../domain/scope-hash.js";

/**
 * LLD §14.2.4 edge case E11 — the ONLY sanctioned entrypoint into the evaluator
 * for every call site outside this module (`orchestration/application/tool-call-
 * pipeline.ts` today; `teams`/`workflows`/`knowledge`'s future call sites per
 * §14.2.5 once their modules exist). A raw `evaluate()` call from outside `authz`
 * is a review-blocking defect (enforced by the `no-raw-authz-evaluate-outside-
 * authz` dependency-cruiser rule as a secondary check, per ADR-0012 §3's "the lint
 * gate is still added").
 *
 * Wraps the pure `evaluate()` in a try/catch: if the evaluator itself throws (a
 * bug, not a `Deny` result — `evaluate()` never throws for a merely-malformed
 * input, that's `SCOPE_MALFORMED`), this logs the failure, writes a
 * `guardrail.evaluator_error` domain-event row for the transactional outbox
 * (LLD §2.4), and returns a fail-closed `Deny(EVALUATOR_ERROR)` rather than
 * letting the exception propagate into a caller that might not fail closed.
 */
export async function evaluateOrDeny(ctx: TenantContext, input: unknown): Promise<PermissionIntersectionResult> {
  try {
    return evaluate(input);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // No file-sink logger exists yet in this codebase (disclosed, matches every
    // other module's current state) — `console.error` is the same-severity
    // logging every other module's catch-and-continue path already uses.
    console.error("[authz] evaluate() threw — failing closed", { tenantId: ctx.tenantId, message });
    let scopeHash: string;
    try {
      scopeHash = hashScopeInput(input);
    } catch {
      scopeHash = hashScopeInput({ malformed: true });
    }
    await appendEvaluatorErrorEvent(ctx, message, scopeHash).catch(() => {
      // A disk-full/DB-unavailable failure while recording the audit trail must
      // never mask the fail-closed Deny below, nor throw into the caller.
    });
    return { decision: "Deny", denyReason: "EVALUATOR_ERROR", denyDetail: message, trace: [], scopeHash };
  }
}

async function appendEvaluatorErrorEvent(ctx: TenantContext, message: string, scopeHash: string): Promise<void> {
  await withTenant(ctx, async (db: TenantScopedClient) => {
    await db.insert(schema.domainEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      type: "guardrail.evaluator_error",
      payload: { message, scopeHash },
    });
  });
}
