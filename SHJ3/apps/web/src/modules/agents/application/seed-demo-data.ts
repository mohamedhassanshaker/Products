/**
 * The application-layer half of the deterministic agents demo-data seed
 * (`scripts/seed-agents-tools-demo-data.ts` — a sibling wave's job, not built here since it
 * also seeds `tools` module data in the same run — is the composition root and CLI entry
 * point).
 *
 * ## Why this is one small, single-tenant-scoped function, not an orchestrator
 *
 * Mirrors `iam`'s own `seed-demo-data.ts` exactly, for the identical reason: `DemoDataSeeder.
 * ensureAgentWithHistory` reaches `getTenantDb()`/`getPlatformDb()`, which resolve from the
 * *ambient* bound tenant (`runWithTenant`), not from a parameter — so a single ambient
 * binding cannot correctly serve agents meant for several different tenants in the same loop
 * (`prisma-user-repository.ts`'s `assertMatchesAmbientTenant` is the same invariant, enforced
 * defensively at the adapter layer here too).
 *
 * `runWithTenant` must not be called from a feature module (`tenant-context.ts`'s own doc
 * comment) — it is the composition root's job. So this function assumes its caller has
 * *already* bound the correct context for `agent.ownerTenant`, and does exactly one agent's
 * worth of work — the future CLI script is what loops over the four demo agents and re-binds
 * tenant context between the ones that differ.
 */

import type { ChannelKey } from "../domain/agent.js";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";
import type { DemoDataSeeder } from "../ports/demo-data-seeder.js";

export interface DemoAgentVersion {
  readonly major: number;
  readonly minor: number;
  readonly status: "Draft" | "Published";
  readonly changeSummary: string | null;
}

export interface DemoAgent {
  readonly ownerTenant: TenantSlug;
  readonly name: string;
  readonly slug: string;
  readonly description: string | null;
  /** Oldest first. The last entry becomes the agent's current version and its status. */
  readonly versions: readonly DemoAgentVersion[];
  readonly enabledChannelKeys: readonly ChannelKey[];
}

/** One demo agent's shell + full version history + channel bindings, in `agent.ownerTenant`. Call under `runWithTenant({tenant: agent.ownerTenant, ...})`. */
export async function seedAgentWithHistory(
  seeder: DemoDataSeeder,
  agent: DemoAgent,
): Promise<{ agentId: string; currentVersionId: string }> {
  return seeder.ensureAgentWithHistory(agent);
}
