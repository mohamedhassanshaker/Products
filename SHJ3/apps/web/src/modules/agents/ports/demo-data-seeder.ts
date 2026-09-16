/**
 * Deterministic demo-data seeding for the agent registry (B2) — closes the agents half of
 * the same long-standing B-0 open item `iam`'s own `demo-data-seeder.ts` already closed for
 * users/teams/roles (`tasks/todo.md`'s B-3 entry: "Agents/source-conflicts sample content
 * remains open for whichever wave builds B-3/B-4"). `scripts/seed-agents-tools-demo-data.ts`
 * (a sibling wave's job, not built here, since it also seeds `tools` module data in the same
 * run) is the eventual composition root and CLI entry point; this port is what it will call
 * into for the agents half of that run.
 *
 * A dedicated port, not a reuse of `AgentRepository`, for exactly the reason `iam`'s own
 * `demo-data-seeder.ts` gives for its own bypass: seeding needs shapes the ordinary B2/B3
 * use cases must never expose. `PublishAgentVersion` can only publish the single Draft
 * version a wizard is actually editing, one publish at a time — it has no way to write
 * three ALREADY-Published historical versions of one agent in a single call (SEWA's
 * v1.2/v1.3/v1.4, all three permanently Published per `domain/version.ts`'s module comment).
 * `CreateAgent`/`CloneAgent` always start a brand-new agent at v0.1 Draft
 * (`INITIAL_DRAFT_VERSION`) — never at an arbitrary historical version number a seed's own
 * narrative needs (`nextDraftVersion`'s own doc comment: a major/minor jump "is a deliberate
 * narrative choice this system has no signal to make on its own" — exactly the choice a
 * hand-authored seed exists to make). This port makes that one bypass, and only that one.
 *
 * One method, not several finer-grained ones (contrast `iam`'s `ensureStaffUser`/
 * `ensureTeam`/`ensureRoleAssignment` split): every seeded agent's shell, full version
 * history, current-version pointer, and channel bindings are a single, self-contained tree
 * that is never mixed with another agent's — unlike `iam`'s staff/team/role rows, which
 * really are reused independently across many (tenant, user) combinations in that seed's own
 * loop. Splitting this into agent-shell/version/pointer/bindings methods the way `iam` splits
 * staff/team/role would not buy any real reuse here, only more call sites for the same one
 * atomic unit. Idempotent throughout — every sub-step is checked before written internally —
 * so re-running after a partial failure resumes rather than duplicates, matching `iam`'s own
 * seed precedent.
 *
 * Every historical version's `publishedAt` and every row's `createdByStaffUserId` (and
 * sibling actor columns) are computed inside the real adapter, not accepted as input here —
 * mirroring `iam`'s own `PrismaDemoDataSeeder`, whose seed methods take no `now`/actor
 * parameter either and instead read the wall clock and a fixed system-seed actor id
 * internally. The wireframe gives no real historical dates for B2's version history, so
 * inventing caller-supplied ones would only move the fabrication one layer up without adding
 * honesty; see the adapter's own doc comment for exactly how it derives a plausible,
 * clearly-synthetic release cadence instead.
 */

import type { ChannelKey } from "../domain/agent.js";
import type { TenantSlug } from "../../platform/tenancy/tenant-slug.js";

export interface DemoDataSeeder {
  /**
   * The whole of one demo agent: shell, every historical version in its real, permanent
   * shape, the current-version pointer (and `Agent.status` set to match the last version),
   * and its channel bindings — in one idempotent call. Call under `runWithTenant` for
   * `ownerTenant`.
   */
  ensureAgentWithHistory(input: {
    readonly ownerTenant: TenantSlug;
    readonly name: string;
    readonly slug: string;
    readonly description: string | null;
    /** Oldest first. The last entry becomes `Agent.currentVersionId`, and its `status` becomes `Agent.status`. */
    readonly versions: readonly {
      readonly major: number;
      readonly minor: number;
      /** This seed never needs `'Archived'` — every demo agent is either currently Published or still an unpublished Draft. */
      readonly status: "Draft" | "Published";
      readonly changeSummary: string | null;
    }[];
    /** Bound to the CURRENT version only — B2's registry channel column reads only the current version's bindings (`AgentRepository.listForRegistry`'s real adapter). */
    readonly enabledChannelKeys: readonly ChannelKey[];
  }): Promise<{ readonly agentId: string; readonly currentVersionId: string }>;
}
