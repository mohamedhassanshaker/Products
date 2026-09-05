import { runProviderProbeSweep } from "@nextbot/model-gateway";

/** Target Architecture Blueprint Phase 1 (BL-32, ADR-0011 §2.1, LLD §14.8.3) —
 * `model-gateway.provider-probe`'s scheduled sweep: FR-AGT-20's reachability/health
 * check, every 60s, for every tenant-owned provider whose own `health_interval_seconds`
 * cadence is due (platform-shared providers excluded this phase — see
 * `listOwnProvidersForTenant`'s doc comment in `@nextbot/model-gateway`). */
export async function runModelGatewayProviderProbe(): Promise<{ tenantsChecked: number; probed: number; failed: number }> {
  return runProviderProbeSweep();
}
