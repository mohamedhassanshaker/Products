import { sweepEscalationSla } from "@nextbot/escalations";

/** Target Architecture Blueprint Phase 13 (BL-45, FR-ESC-05, LLD §14.9.2) — flips
 *  `sla_breached` for any `Waiting`/`InProgress` escalation past its configured
 *  `sla_due_at`. Runs every 60s per LLD's own stated cadence for this job. */
export async function runEscalationSlaSweep(): Promise<ReturnType<typeof sweepEscalationSla>> {
  return sweepEscalationSla();
}
