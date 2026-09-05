import { runContinuousEvalSweep } from "@nextbot/agent-platform";

/** Target Architecture Blueprint Phase 12 (BL-44, FR-AGT-17) — scheduled eval
 * runs against every tenant's currently-deployed Production version(s), to
 * catch model-provider drift. Mirrors `knowledge-retention-purge.ts`'s own
 * one-line delegation to a cross-tenant sweep function. */
export async function runEvalContinuousRun(): Promise<ReturnType<typeof runContinuousEvalSweep>> {
  return runContinuousEvalSweep();
}
