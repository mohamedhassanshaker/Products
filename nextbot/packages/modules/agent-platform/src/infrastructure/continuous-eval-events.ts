import { generateId, schema, withTenant, type TenantContext, type TenantScopedClient } from "@nextbot/db";

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17) — appends
 * `eval.regression_detected` to the transactional outbox (`domain_event`, LLD
 * §2.4), matching this codebase's own established convention of writing
 * directly to the shared `domain_event` table rather than routing through
 * another module (`deployment-repository.ts`'s `emergencyRollbackRepoint` does
 * the identical thing). Kept in its own tiny file (not `eval-service.ts`) so
 * both `eval-service.ts` (the run that detects the regression) and
 * `continuous-eval-service.ts` (the worker-facing sweep that triggers the run)
 * can import it without creating a cycle between those two files.
 */
export async function appendContinuousRegressionEvent(
  ctx: TenantContext,
  input: { evalSuiteId: string; agentDefinitionVersionId: string; evalRunId: string; passRatePct: number; baselineRunId?: string },
): Promise<void> {
  await withTenant(ctx, (db: TenantScopedClient) =>
    db.insert(schema.domainEvent).values({
      id: generateId(),
      tenantId: ctx.tenantId,
      type: "eval.regression_detected",
      payload: {
        evalSuiteId: input.evalSuiteId,
        agentDefinitionVersionId: input.agentDefinitionVersionId,
        evalRunId: input.evalRunId,
        passRatePct: input.passRatePct,
        baselineRunId: input.baselineRunId ?? null,
      },
    }),
  );
}
