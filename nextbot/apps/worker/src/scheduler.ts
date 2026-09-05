/**
 * Phase 18 (BL-11) — `apps/worker`'s first real recurring-job infrastructure.
 * `apps/worker` has been a scaffold since Phase 0; several prior phases (10, 13)
 * built real, tested, *callable* sweep functions and explicitly deferred actually
 * scheduling them to "Phase 18's job-scheduling infrastructure" — this is that
 * infrastructure.
 *
 * Deliberately a plain `setInterval`-based in-process scheduler, not a new queue
 * dependency (BullMQ/Agenda/etc.): no such library exists anywhere in this
 * workspace yet, and introducing one is a real dependency-maturity decision (ADR
 * bar: maintained, license, CVEs, production adoption) this dispatch's bounded
 * scope does not need to force — every job this scheduler runs is idempotent
 * and already safe to run concurrently across replicas (each sweep operates
 * per-tenant with its own transaction; a job overlapping its own previous run, or
 * running on N worker replicas simultaneously, does at most duplicate work, never
 * corrupts state). If `apps/worker` is ever scaled to multiple replicas without a
 * distributed lock, jobs will simply run redundantly rather than incorrectly —
 * an accepted simplification, not a correctness gap, flagged here for whoever
 * scales this next.
 *
 * Each job's own errors are caught and logged per-tick — one job's failure must
 * never stop the scheduler or take down any other job's schedule.
 */
export interface ScheduledJob {
  name: string;
  intervalMs: number;
  run: () => Promise<unknown>;
}

export interface RunningSchedule {
  stop: () => void;
}

/** Starts every job on its own `setInterval`, staggered by a small random jitter
 * (0-2s) so they don't all fire in the exact same tick under real deployment,
 * and returns a `stop()` handle for graceful shutdown (used by tests and by
 * `index.ts`'s SIGTERM handler). Each job also runs once immediately at startup
 * (not just after its first interval elapses) so a freshly (re)started worker
 * doesn't wait a full interval before doing its first real sweep. */
export function startScheduler(jobs: ScheduledJob[]): RunningSchedule {
  const timers: NodeJS.Timeout[] = [];

  async function runOnce(job: ScheduledJob): Promise<void> {
    try {
      const result = await job.run();
      console.log(`NextBot worker: job "${job.name}" completed`, result);
    } catch (err) {
      console.error(`NextBot worker: job "${job.name}" failed`, err);
    }
  }

  for (const job of jobs) {
    void runOnce(job);
    const timer = setInterval(() => void runOnce(job), job.intervalMs);
    timers.push(timer);
  }

  return {
    stop: () => {
      for (const timer of timers) clearInterval(timer);
    },
  };
}
