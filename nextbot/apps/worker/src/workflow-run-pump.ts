import { createOrchestrationNodeRuntime, newWorkerInstanceId, pumpWorkflowRuns } from "@nextbot/workflows";
import { createMcpEgressPort } from "@nextbot/tool-registry";

/**
 * Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-05/06, LLD §14.6.2's corrected
 * job table, ADR-0013 §7) — **the workflow executor's host**.
 *
 * This job CLAIMS AND ADVANCES runs itself; it is not a discovery-and-signal path,
 * because there is no second process to signal. ADR-0013 §2.4 originally placed the
 * executor in `apps/runtime` beside a `run-orchestrator`, but neither has ever existed
 * (`apps/runtime/src/index.ts` is still `export {};` with no Dockerfile, no compose
 * service and no k8s Deployment), so §7's amendment corrected the placement to this
 * process. ADR-0013's actual goal is preserved exactly: zero new deployables, zero new
 * stateful dependencies, one durable state model in Postgres.
 *
 * 5s tick, modelled on `knowledge.ingestion-pump` — the real, QA-approved durable-work
 * pump in this codebase. All logic lives in `@nextbot/workflows`; this file is a shim,
 * matching `escalation-sla-sweep.ts`'s three-line style.
 *
 * **The one worker instance id, created once at module load**, becomes
 * `workflow_run_lease.owner`. It must be stable across ticks so a lease this replica
 * renews mid-step is still recognizably its own — regenerating it per tick would make
 * every renewal fail and every run take exactly one node per lease TTL.
 */
const WORKER_INSTANCE_ID = newWorkerInstanceId();

export async function runWorkflowRunPump(): Promise<ReturnType<typeof pumpWorkflowRuns>> {
  return pumpWorkflowRuns({
    // Per-tenant, not per-process: every adapter closes over a `TenantContext` so
    // `withTenant`'s RLS holds for every read and write it makes.
    runtimeFor: (ctx) => createOrchestrationNodeRuntime(ctx, { egress: createMcpEgressPort(ctx) }),
    owner: WORKER_INSTANCE_ID,
    maxRunsPerTenant: 10,
  });
}
