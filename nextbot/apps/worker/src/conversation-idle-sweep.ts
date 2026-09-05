import { sweepIdleConversationsAcrossAllTenants } from "@nextbot/conversations";

/**
 * LLD §11's named job list includes `conversation.idle-sweep` (intended 60s
 * interval). Same "callable, tested, not-yet-cron-scheduled" convention
 * `agent-platform-git-sweep.ts` (Phase 10) established: the real logic
 * (`sweepIdleConversationsAcrossAllTenants`, exercised end-to-end in
 * `@nextbot/conversations`'s integration suite) is real; wiring an actual
 * recurring 60s job (BullMQ repeatable job / cron) is Phase 18's job-scheduling
 * infrastructure, not this phase's.
 */
export async function runConversationIdleSweep(): Promise<{ tenantsChecked: number; abandoned: number; resolved: number }> {
  return sweepIdleConversationsAcrossAllTenants();
}
