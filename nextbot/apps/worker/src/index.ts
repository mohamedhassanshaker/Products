import { startScheduler, type RunningSchedule } from "./scheduler.js";
import { runAgentPlatformGitSweep } from "./agent-platform-git-sweep.js";
import { runConversationIdleSweep } from "./conversation-idle-sweep.js";
import { runAuditSync } from "./audit-sync.js";
import { runMcpHealthCheck } from "./mcp-health-check.js";
import { runRetentionPurgeSweep } from "./retention-purge.js";
import { runMcpManifestReconcile } from "./mcp-manifest-reconcile.js";
import { runModelGatewayProviderProbe } from "./model-gateway-provider-probe.js";
import { runModelGatewayCatalogSync } from "./model-gateway-catalog-sync.js";
import { runTenancyGraphProvisioningReconcile } from "./tenancy-graph-provisioning-reconcile.js";
import { runKnowledgeIngestionPump } from "./knowledge-ingestion-pump.js";
import { runKnowledgeLeaseReaper } from "./knowledge-lease-reaper.js";
import { runKnowledgeSourceSync } from "./knowledge-source-sync.js";
import { runKnowledgeRetentionPurge } from "./knowledge-retention-purge.js";
import { runEvalContinuousRun } from "./eval-continuous-run.js";
import { runEscalationSlaSweep } from "./escalation-sla-sweep.js";
import { runApprovalsExpirySweep } from "./approvals-expiry-sweep.js";
import { runWorkflowRunPump } from "./workflow-run-pump.js";
import { runWorkflowLeaseReaper } from "./workflow-lease-reaper.js";
import { runWorkflowSuspensionExpirySweep } from "./workflow-suspension-expiry-sweep.js";
import { runDeploymentShadowRunPump } from "./deployment-shadow-run-pump.js";
import { runDeploymentShadowLeaseReaper } from "./deployment-shadow-lease-reaper.js";
import { runWebhooksDispatch } from "./webhooks-dispatch.js";
import { runTelemetryOtelMetricsExport } from "./telemetry-otel-metrics-export.js";
import { runTelemetrySiemExport } from "./telemetry-siem-export.js";

/**
 * `apps/worker`'s job registry (Phase 18, BL-11) — the first time this app has
 * actually wired real recurring scheduling rather than existing only as a
 * scaffold of individually-callable-but-unscheduled functions (Phases 10 and 13
 * each built a real, tested sweep and explicitly deferred scheduling it to this
 * phase).
 *
 * Deliberately side-effect-free (does not start anything itself) so importing
 * this module — from a test, or from `main.ts` — never has the side effect of
 * starting real intervals against real infra; `main.ts` is the only real process
 * entry point that calls `startWorker()`.
 *
 * Job intervals:
 *  - `agent-platform.git-sweep` — 15 min (ADR-0009's polling reconciliation fallback).
 *  - `conversation.idle-sweep` — 60s (LLD §11's named interval).
 *  - `audit.outbox-sync` — 30s (keeps the Audit Log Viewer close to real-time).
 *  - `mcp.health-check` — 60s (matches most connectors' default `health_interval_seconds`).
 *  - `tenancy.retention-purge` — 1 hour (a daily-cadence job run hourly is a safe,
 *    idempotent over-approximation — it only ever deletes rows already past their
 *    retention cutoff, so running it more often than strictly necessary changes
 *    nothing about correctness, only how quickly a newly-crossed cutoff is acted on).
 *  - `knowledge.retention-purge` — 1 hour (Target Architecture Blueprint Phase 11,
 *    BL-42, FR-KB-08/FR-ADM-06 — same idempotent-over-approximation reasoning as
 *    `tenancy.retention-purge` above, applied to `knowledge_collection.retention_days`).
 *  - `escalation.sla-sweep` — 60s (Target Architecture Blueprint Phase 13, BL-45,
 *    FR-ESC-05, LLD §14.9.2's own stated cadence).
 */
export function startWorker(): RunningSchedule {
  return startScheduler([
    { name: "agent-platform.git-sweep", intervalMs: 15 * 60_000, run: runAgentPlatformGitSweep },
    { name: "conversation.idle-sweep", intervalMs: 60_000, run: runConversationIdleSweep },
    { name: "audit.outbox-sync", intervalMs: 30_000, run: runAuditSync },
    { name: "mcp.health-check", intervalMs: 60_000, run: runMcpHealthCheck },
    { name: "tenancy.retention-purge", intervalMs: 60 * 60_000, run: runRetentionPurgeSweep },
    // Phase 6 (BL-29, ADR-0014, LLD §14.3.6) — 60s sweep tick; per-server cadence is
    // each mcp_server row's own reconcile_interval_seconds.
    { name: "mcp.manifest-reconcile", intervalMs: 60_000, run: runMcpManifestReconcile },
    // Target Architecture Blueprint Phase 1 (BL-32, ADR-0011 §2.1, LLD §14.8.3) — 60s
    // sweep tick; per-provider cadence is each model_provider row's own
    // health_interval_seconds.
    { name: "model-gateway.provider-probe", intervalMs: 60_000, run: runModelGatewayProviderProbe },
    // 6h sweep tick (ADR-0011 §2.1's catalog-sync cadence).
    { name: "model-gateway.catalog-sync", intervalMs: 6 * 60 * 60_000, run: runModelGatewayCatalogSync },
    // Target Architecture Blueprint Phase 7b fast-follow (ADR-0018 §4) — repairs a
    // tenant left with `tenant_graph_database_route.provisioned_at IS NULL`; a rare,
    // already-non-fatal condition, so a 5-minute cadence is appropriate.
    { name: "tenancy.graph-provisioning-reconcile", intervalMs: 5 * 60_000, run: runTenancyGraphProvisioningReconcile },
    // Target Architecture Blueprint Phase 7b (BL-38, LLD §14.4.3) — the knowledge
    // ingestion pipeline's own pump/reaper/source-sync jobs, run inside apps/worker
    // (disclosed narrowing of LLD §15.3.2's `apps/ingest` deployable — see
    // packages/modules/knowledge/README.md).
    { name: "knowledge.ingestion-pump", intervalMs: 5_000, run: runKnowledgeIngestionPump },
    { name: "knowledge.lease-reaper", intervalMs: 60_000, run: runKnowledgeLeaseReaper },
    { name: "knowledge.source-sync", intervalMs: 60_000, run: runKnowledgeSourceSync },
    // Target Architecture Blueprint Phase 11 (BL-42, FR-KB-08/FR-ADM-06) — 1-hour
    // cadence, matching `tenancy.retention-purge`'s own reasoning.
    { name: "knowledge.retention-purge", intervalMs: 60 * 60_000, run: runKnowledgeRetentionPurge },
    // Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17) — scheduled eval
    // runs against every tenant's currently-deployed Production version(s), to
    // catch model-provider drift independent of the pre-promotion gate. 1-hour
    // cadence: frequent enough to catch drift promptly, infrequent enough that
    // it never becomes the dominant driver of eval/model-gateway spend for a
    // tenant with many deployed agents.
    { name: "eval.continuous-run", intervalMs: 60 * 60_000, run: runEvalContinuousRun },
    // Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) — 60s
    // sweep tick per the LLD's own stated cadence for this job.
    { name: "escalation.sla-sweep", intervalMs: 60_000, run: runEscalationSlaSweep },
    // Target Architecture Blueprint Phase 16 (BL-47b, ADR-0013 §7.4) — the Tier-2/Tier-3
    // approval-expiry sweeper. Closes a gap `orchestration`'s own `approval-service.ts`
    // has disclosed since Phase 14: nothing ever produced the terminal `Expired` state,
    // so `decideTier2()`/`decideTier3()`'s `ApprovalExpiredError` branch was unreachable
    // and an approver could act on a request long past its own stated deadline. Landed
    // BEFORE the workflow suspension path below, which is built on top of it. 60s,
    // matching `escalation.sla-sweep`'s cadence for the same class of work.
    { name: "approvals.expiry-sweep", intervalMs: 60_000, run: runApprovalsExpirySweep },
    // Target Architecture Blueprint Phase 16 (BL-47b, FR-WF-05/06/07, LLD §14.6.2's
    // corrected job table, ADR-0013 §7) — the Workflow Designer's durable-execution
    // runtime. `apps/worker` HOSTS the executor: it claims and advances runs itself
    // rather than signalling another process, because there is no other process
    // (`apps/runtime` is an empty Phase-0 scaffold with no image and no deployment, and
    // there is no `run-orchestrator`). Net new deployables for this phase: zero.
    //
    // These are the FIRST jobs in this scheduler for which redundant concurrent
    // execution would NOT be harmless — the executor advances a state machine with real
    // side effects, unlike every idempotent sweep above it. `workflow_run_lease`'s
    // `INSERT ... ON CONFLICT ... WHERE expires_at < now()` claim is what restores this
    // scheduler's "safe across replicas without a distributed lock" assumption, and it
    // is tested against genuinely concurrent claimers rather than asserted.
    //
    // 5s pump / 60s reaper / 60s expiry, per LLD §14.6.2's corrected table. There is no
    // delayed-job fast path: no queue library exists in this workspace, so the
    // reconciling sweep is the only path and is authoritative — wake-up latency is
    // bounded by these ticks, well inside FR-WF-05's hours-to-days semantics.
    { name: "workflow.run-pump", intervalMs: 5_000, run: runWorkflowRunPump },
    { name: "workflow.lease-reaper", intervalMs: 60_000, run: runWorkflowLeaseReaper },
    { name: "workflow.suspension-expiry-sweep", intervalMs: 60_000, run: runWorkflowSuspensionExpirySweep },
    // Target Architecture Blueprint Phase 17 (BL-48, ADR-0019 §2.5, LLD §15.5) — shadow
    // evaluation's asynchronous replay. 5s pump / 60s reaper, the same cadence pair as
    // `knowledge.ingestion-pump`/`knowledge.lease-reaper` and `workflow.run-pump`/
    // `workflow.lease-reaper`, whose claim-lease-reclaim idiom this reuses verbatim.
    //
    // Safe across replicas for the same reason the workflow pump is: `shadow_run`'s
    // `FOR UPDATE SKIP LOCKED` claim plus its `lease_owner`/`lease_expires_at` pair means
    // two replicas never process the same row, and the reaper is what makes a crashed
    // replica's row retryable rather than stranded.
    //
    // A shadow run costs real money (real provider round-trips on real customer content),
    // so it is bounded on three independent axes rather than one: the experiment's own
    // `sample_pct`/`max_runs`/`max_cost_usd` ceilings, the per-tenant per-tick claim limit
    // inside the pump, and the tenant's ordinary `tenant_runtime_quota` concurrency slot —
    // which the pump treats as "defer", never as a reason to 429 a real customer.
    { name: "deployment.shadow-run-pump", intervalMs: 5_000, run: runDeploymentShadowRunPump },
    { name: "deployment.shadow-lease-reaper", intervalMs: 60_000, run: runDeploymentShadowLeaseReaper },
    // Target Architecture Blueprint Phase 18 (BL-49, FR-API-02) — outbound webhooks.
    // 10s: shorter than `audit.outbox-sync`'s 30s, since a tenant's own outbound
    // integration is more latency-sensitive than the in-console Audit Log Viewer, but
    // this is a genuinely INDEPENDENT consumer of the same `domain_event` table —
    // neither job's cadence or progress affects the other (see `@nextbot/webhooks`'
    // own schema-file doc comment for the non-interference design).
    { name: "webhooks.dispatch", intervalMs: 10_000, run: runWebhooksDispatch },
    // Target Architecture Blueprint Phase 18 (BL-49, FR-ADM-10) — tenant-scoped,
    // opt-in OTel/SIEM export, additive to the existing in-console Runtime Traces/
    // Audit Log experiences. 5-minute cadence for the metric snapshot (matches the
    // aggregation window it computes over); 60s for the SIEM batch export (matches
    // `escalation.sla-sweep`'s cadence for this class of "near-real-time external
    // system" work).
    { name: "telemetry.otel-metrics-export", intervalMs: 5 * 60_000, run: runTelemetryOtelMetricsExport },
    { name: "telemetry.siem-export", intervalMs: 60_000, run: runTelemetrySiemExport },
  ]);
}
