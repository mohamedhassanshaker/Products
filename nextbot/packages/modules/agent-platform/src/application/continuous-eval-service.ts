import { listActiveTenantContexts } from "@nextbot/tenancy";
import { listActiveProductionDeployments } from "../infrastructure/deployment-repository.js";
import { getAgentDefinitionVersion } from "../infrastructure/agent-definition-repository.js";
import { runEvalSuite } from "./eval-service.js";

/**
 * Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17, LLD §14.9.3) —
 * scheduled eval runs execute against the CURRENTLY-DEPLOYED Production
 * version (not only pre-promotion), to catch model-provider drift. Cron-driven
 * via `apps/worker`'s own recurring-job infrastructure (`ScheduledJob` +
 * `startScheduler`, `apps/worker/src/scheduler.ts`) — this codebase has no
 * `job_schedule` table; that infrastructure (a plain per-job `setInterval`,
 * Phase 18/BL-11) is the real, already-established scheduling mechanism this
 * dispatch's own brief asked to "find and reuse," corrected here to match what
 * actually exists rather than a name that was never built.
 *
 * Mirrors `sweepKnowledgeRetention`'s own cross-tenant sweep shape
 * (`@nextbot/knowledge`) exactly: one tenant's failure never aborts the sweep
 * for every other tenant.
 *
 * **Target Architecture Blueprint Phase 17 (BL-48) audit note — reviewed, no change
 * needed, and the behavior change is deliberate.** This sweep reads
 * `listActiveProductionDeployments`, which before Phase 17 could only ever return one row
 * per agent definition (no writer produced two). With `setTrafficSplit` it can now return
 * several — one per canary arm — and this loop consequently schedules a continuous eval
 * run against **every version currently serving real Production traffic**, not just the
 * majority one. That is the correct reading of FR-AGT-17 ("the currently-deployed
 * Production version"): a 10% canary arm is deployed Production traffic and is exactly the
 * arm most worth catching drift on.
 *
 * It creates `EvalCase`-trigger runs and never a `ShadowEvaluation` one, and it reads
 * `deployment`, not `agent_run`, so shadow evaluation cannot influence what it schedules.
 */
export interface ContinuousEvalSweepResult {
  tenantsChecked: number;
  runsExecuted: number;
}

export async function runContinuousEvalSweep(): Promise<ContinuousEvalSweepResult> {
  const tenants = await listActiveTenantContexts();
  let runsExecuted = 0;

  for (const ctx of tenants) {
    try {
      const deployments = await listActiveProductionDeployments(ctx);
      for (const deployment of deployments) {
        const version = await getAgentDefinitionVersion(ctx, deployment.agentDefinitionVersionId);
        // Only a version with an eval suite bound can be continuously evaluated
        // — a version predating the promotion gate's own eval-binding
        // requirement (none should exist in practice, since binding is
        // required before `EvalGated`) is silently skipped, never errored.
        if (!version.evalSuiteId) continue;
        await runEvalSuite(ctx, { agentDefinitionVersionId: version.id, triggeredBy: "Scheduled", runKind: "Continuous" });
        runsExecuted += 1;
      }
    } catch (err) {
      console.error(`NextBot worker: continuous-eval sweep failed for tenant "${ctx.tenantId}"`, err);
    }
  }

  return { tenantsChecked: tenants.length, runsExecuted };
}
