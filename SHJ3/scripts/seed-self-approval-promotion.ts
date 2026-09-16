/**
 * CLI entry point that seeds exactly one real, DB-persisted `PromotionRequests` row for
 * the `sharjah` tenant, requested BY Ahmed Saeed (SuperAdmin) himself against the most
 * recently `Published` `AgentVersion` this tenant has — so `e2e/backoffice/
 * governance.spec.ts` can click "Approve" on it as Ahmed through the real, running UI
 * and observe the real FR-GOV-15 separation-of-duties rejection.
 *
 *   pnpm exec tsx scripts/seed-self-approval-promotion.ts
 *
 * ## Why this script exists at all
 *
 * `environments-tab.tsx` wires `requestPromotionAction` into `GovernanceScreenActions`
 * but no button anywhere in the shipped UI ever calls it (confirmed by reading the whole
 * tab component, not assumed) — there is no "request a promotion" form yet. Exactly
 * `scripts/mint-e2e-sessions.ts`'s own reasoning applies here: this is not a workaround
 * for an inconvenient UI, it is the only way to reach this real, DB-enforced business
 * rule at all until a create form ships.
 *
 * ## Why this is a separate `tsx` script rather than inline in the spec
 *
 * `e2e/support/mint-session.ts`'s own module comment names the rule this follows:
 * anything importing deep into `apps/web/src/modules/...` (real Prisma clients here)
 * runs under `tsx`, never under Playwright's own esbuild-based transform. This script
 * prints one line of JSON to stdout; `governance.spec.ts` spawns it via
 * `node:child_process` and parses that line — the same shape of boundary
 * `e2e/global-setup.ts` already keeps for every other piece of real infrastructure.
 *
 * ## Output contract (stdout, last line)
 *
 * `{"ok":true,"promotionRequestId":"...","agentName":"...","versionLabel":"v1.0"}` on
 * success, or `{"ok":false,"reason":"no_published_version"}` when the `sharjah` tenant
 * has no `Published` `AgentVersion` yet to promote (a fresh environment that has never
 * run `e2e/backoffice/agents.spec.ts`'s own golden path) — the caller skips cleanly
 * rather than failing on an unrelated precondition.
 *
 * Idempotent by REUSE rather than by upsert: `UQ_PromotionRequests_pending` (a filtered
 * unique index on `(agentVersionId, toEnvironmentKey) WHERE status = 'AwaitingApproval'`)
 * means a second run against the same still-pending version+target would otherwise fail
 * outright — expected here, since this promotion's whole point is that its approval is
 * always refused (FR-GOV-15), so it never resolves out of `AwaitingApproval` on its own.
 * A run that hits that exact collision looks up and returns the SAME existing pending
 * row instead of erroring, so re-running this script (or re-running the Playwright spec
 * that spawns it) stays safe.
 */

import { randomUUID } from "node:crypto";
import { runWithTenant } from "../apps/web/src/modules/platform/tenancy/tenant-context.js";
import { assertValidSlugShape } from "../apps/web/src/modules/platform/tenancy/tenant-slug.js";
import {
  disconnectAllTenantDbs,
  getTenantDb,
} from "../apps/web/src/modules/platform/adapters/outbound/sql/tenant-db.js";
import { disconnectCache } from "../apps/web/src/modules/platform/adapters/outbound/cache/tenant-cache.js";
import { PrismaUserRepository } from "../apps/web/src/modules/iam/adapters/outbound/sql/prisma-user-repository.js";
import { PrismaEnvironmentRepository } from "../apps/web/src/modules/governance/adapters/outbound/sql/prisma-environment-repository.js";
import { PrismaPromotionRequestRepository } from "../apps/web/src/modules/governance/adapters/outbound/sql/prisma-promotion-repository.js";
import { RequestPromotion } from "../apps/web/src/modules/governance/application/request-promotion.js";
import type { PublishGateChecker } from "../apps/web/src/modules/evaluation/ports/publish-gate-checker.js";

const AHMED_EMAIL = "ahmed.saeed@shj.ae";
const TENANT = "sharjah";
// `development.promotesToKey === "uat"` (`scripts/seed-governance-demo-data.ts`) — a real
// chain-valid, non-live target, so `RequestPromotion` never calls the gate at all
// (`targetIsLive` false) and this script needs no golden-set/regression-run fixtures.
const FROM_ENVIRONMENT_KEY = "development";
const TO_ENVIRONMENT_KEY = "uat";

/** Never invoked for a non-live target — see `FROM_ENVIRONMENT_KEY`'s comment above. A
 *  throwing stub keeps this script's import graph narrow (no evaluation-module wiring
 *  needed) while still satisfying `RequestPromotion`'s constructor type honestly. */
const UNUSED_GATE: PublishGateChecker = {
  evaluateForPublish() {
    throw new Error("[seed-self-approval-promotion] gate unexpectedly invoked for Publish.");
  },
  evaluateForPromotion() {
    throw new Error("[seed-self-approval-promotion] gate unexpectedly invoked for Promotion.");
  },
  recordEvaluation() {
    throw new Error(
      "[seed-self-approval-promotion] gate unexpectedly invoked for a non-live target.",
    );
  },
};

type Output =
  | {
      readonly ok: true;
      readonly promotionRequestId: string;
      readonly agentName: string;
      readonly versionLabel: string;
    }
  | { readonly ok: false; readonly reason: string };

async function main(): Promise<Output> {
  return runWithTenant(
    {
      tenant: assertValidSlugShape(TENANT),
      principal: null,
      traceId: randomUUID().replace(/-/g, ""),
      platformScope: "identity",
    },
    async () => {
      const users = new PrismaUserRepository();
      const ahmed = await users.findByEmail(AHMED_EMAIL);
      if (!ahmed) {
        throw new Error(
          `[seed-self-approval-promotion] "${AHMED_EMAIL}" was not found — run \`pnpm db:seed:iam\` first.`,
        );
      }

      const db = getTenantDb("seed self-approval promotion request");
      const version = await db.agentVersion.findFirst({
        where: { status: "Published", deletedAt: null },
        orderBy: { createdAt: "desc" },
        include: { agent: true },
      });
      if (!version) return { ok: false, reason: "no_published_version" };

      // Reuse an already-pending promotion for this exact version+target if one exists
      // (a prior run of this same script, never resolved because its own approval is
      // always refused) — see this file's own module comment on `UQ_PromotionRequests_
      // pending`.
      const existingPending = await db.promotionRequest.findFirst({
        where: {
          agentVersionId: version.id,
          toEnvironmentKey: TO_ENVIRONMENT_KEY,
          status: "AwaitingApproval",
        },
      });
      if (existingPending) {
        return {
          ok: true,
          promotionRequestId: existingPending.id,
          agentName: version.agent.name,
          versionLabel: `v${version.major}.${version.minor}`,
        };
      }

      const requestPromotion = new RequestPromotion({
        promotions: new PrismaPromotionRequestRepository(),
        environments: new PrismaEnvironmentRepository(),
        gate: UNUSED_GATE,
      });

      const result = await requestPromotion.execute({
        agentVersionId: version.id,
        fromEnvironmentKey: FROM_ENVIRONMENT_KEY,
        toEnvironmentKey: TO_ENVIRONMENT_KEY,
        requestedByStaffUserId: ahmed.id,
        now: new Date(),
      });

      if (!result.ok) {
        throw new Error(
          `[seed-self-approval-promotion] unexpected gate rejection requesting a non-live ` +
            `promotion: ${JSON.stringify(result.decision)}`,
        );
      }

      return {
        ok: true,
        promotionRequestId: result.promotionRequestId,
        agentName: version.agent.name,
        versionLabel: `v${version.major}.${version.minor}`,
      };
    },
  );
}

main()
  .then((output) => {
    console.info(JSON.stringify(output));
  })
  .catch((error: unknown) => {
    console.error("[seed-self-approval-promotion] failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await disconnectAllTenantDbs();
    await disconnectCache();
  });
