import { reconcileOpenPrsAcrossAllTenants } from "@nextbot/agent-platform";

/**
 * ADR-0009's 15-minute polling reconciliation fallback — the **callable, tested**
 * unit (`reconcileOpenPrsAcrossAllTenants`, exercised end-to-end in
 * `packages/modules/agent-platform`'s integration suite) is real; this file is a
 * flagged, minimal invocation entrypoint, **not** a running recurring job — actually
 * scheduling it on a 15-minute interval (a real BullMQ repeatable job / cron
 * registration) is deferred to Phase 18, the phase that stands up `apps/worker`'s
 * job-scheduling infrastructure for real (health-check sweeps, retention purge,
 * reporting rollups all land there too, per `docs/plans/nextbot-plan.md`). Calling
 * this function directly (e.g. from a one-off ops script, or a platform cron
 * configured outside this codebase in the interim) is safe and correct today; it is
 * simply not wired to fire on its own schedule yet.
 */
export async function runAgentPlatformGitSweep(): Promise<{ tenantsChecked: number }> {
  return reconcileOpenPrsAcrossAllTenants();
}
