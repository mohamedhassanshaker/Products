/**
 * Playwright `globalSetup` — runs once, before any worker starts, against the real running
 * stack (`docs/testing.md` §2.4/§4.1: "the wireframe's cross-module wiring only
 * demonstrates correctly from a known starting state").
 *
 * Deliberately a thin process-spawning wrapper, not a module that imports application code
 * directly — see `scripts/mint-e2e-sessions.ts`'s own module comment for why: every step
 * that touches real Prisma/Redis/native-addon infrastructure runs through `tsx`
 * (`pnpm db:seed:*`), the same way `scripts/verify.mjs` orchestrates its own stages via
 * `spawnSync` rather than importing them in-process. One definition of "how a TypeScript
 * script touches real infrastructure in this repo."
 *
 * ## Ordering, and why it is exactly this order
 *
 *  1. `db:seed:iam` — tenants, staff users, teams, roles. Every later step depends on the
 *     five demo `StaffUsers` rows this creates.
 *  2. `db:seed:agents` — the four tenants' seeded agents, skills, MCP servers, API
 *     connectors, circuit breakers (the fixtures `e2e/backoffice/agents.spec.ts` and
 *     `tools.spec.ts` assert against, including the tenant-isolation case's two
 *     structurally-identical, value-distinct agents).
 *  3. `db:seed:appearance` — the two shipped skins (`e2e/backoffice/appearance.spec.ts`).
 *  4. `db:seed:knowledge` — sources, retrieval config, conflicts for `/knowledge`
 *     (`e2e/backoffice/knowledge.spec.ts`). Depends on step 1's tenants.
 *  5. `db:seed:channels` — channels, handover hours, templates (including the seeded-
 *     `Pending` `appointment_confirmation` template and its seeded-`Blocked` campaign) and
 *     campaigns for `/channels` (`e2e/backoffice/channels.spec.ts`). Depends on step 2's
 *     seeded `sewa` agent and step 1's `SEWA Billing` team.
 *  6. `db:seed:escalations` — routing rules and canned replies for `/escalations`
 *     (`e2e/backoffice/escalations.spec.ts`). Depends on step 5's `HandoverConfig`/
 *     `WorkingHoursProfile` rows and step 1's `SEWA Billing` team.
 *  7. `db:seed:identity-payments` — step-up rules, verification providers, payment
 *     gateways for `/identity` (`e2e/backoffice/identity.spec.ts`).
 *  8. `db:seed:governance` — `platform.Environments` for `/governance`
 *     (`e2e/backoffice/governance.spec.ts`).
 *  9. `db:seed:e2e-credentials` — password + TOTP secret for the four `Active` demo users
 *     this suite signs in as (a fourth, `sewa`-tenant `LiveAgent`, was added 2026-09-10 for
 *     `e2e/journeys/conversation-widget.spec.ts` — see `seed-iam-demo-data.ts`'s own `USERS`
 *     comment). Depends on step 1's `StaffUsers` rows existing.
 *  10. `db:seed:e2e-sessions` — mints the four real staff sessions and writes
 *     `e2e/.auth/*.json`, which every authenticated spec loads via `storageState`. Depends
 *     on step 9's credentials.
 *
 * `evaluation` and `command-centre` have no dedicated seed step: their golden-path
 * coverage creates its own golden set / relies on the real (possibly-empty) metrics
 * rollup rather than a fixture script — see those specs' own module comments.
 *
 * ## Idempotency, and the one thing this deliberately does NOT do
 *
 * All five steps are safe to re-run — `tasks/lessons.md` documents that
 * `seed-iam-demo-data.ts`/`seed-agents-tools-demo-data.ts`/`seed-system-skins.ts` are each
 * idempotent by their own doc comments, `seed-e2e-credentials.ts` is an `upsert`, and
 * `mint-e2e-sessions.ts` simply mints a fresh session every run (sessions are 12-hour-TTL
 * and single-use by design, so "idempotent" for that step means "safe to repeat", not
 * "no-op on a repeat"). This is what makes a plain re-run of `globalSetup` the "reset to a
 * known baseline" this suite needs, with no separate teardown/wipe step required.
 *
 * What this does NOT do: run `pnpm test:isolation`. `tasks/lessons.md` records that the
 * isolation suite's own setup/teardown provisions-then-destroys `sewa`/`customs` on every
 * run — a materially different lifecycle from this suite's "seed once, leave it" fixtures.
 * Running it here would wipe the very tenants this suite depends on. The isolation suite
 * remains a separate, deliberate release-gate action (`scripts/verify.mjs`'s own doc
 * comment), never invoked from E2E `globalSetup`.
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// `__dirname`, not `import.meta.dirname`: Playwright's own config/globalSetup loader
// transpiles this file to CommonJS (confirmed directly — `import.meta` throws
// `SyntaxError: Cannot use 'import.meta' outside a module` under it), unlike the `tsx`
// runtime every `scripts/*.ts` file in this repo runs under, which is real ESM.
const ROOT = resolve(__dirname, "..");
const isWindows = process.platform === "win32";

const SETUP_STEPS: readonly { readonly label: string; readonly script: string }[] = [
  { label: "seed IAM demo data (tenants, users, teams, roles)", script: "db:seed:iam" },
  { label: "seed agents/tools demo data", script: "db:seed:agents" },
  { label: "seed appearance/skins demo data", script: "db:seed:appearance" },
  { label: "seed knowledge demo data", script: "db:seed:knowledge" },
  { label: "seed channels/templates/campaigns demo data", script: "db:seed:channels" },
  {
    label: "seed escalation routing-rules/canned-replies demo data",
    script: "db:seed:escalations",
  },
  { label: "seed identity/payments demo data", script: "db:seed:identity-payments" },
  { label: "seed governance environments demo data", script: "db:seed:governance" },
  { label: "seed E2E staff credentials", script: "db:seed:e2e-credentials" },
  { label: "mint E2E staff sessions", script: "db:seed:e2e-sessions" },
];

export default async function globalSetup(): Promise<void> {
  console.info("");
  console.info("E2E global setup — seeding deterministic fixtures against the real stack");
  console.info("─".repeat(72));

  for (const step of SETUP_STEPS) {
    const started = Date.now();
    const proc = spawnSync("pnpm", ["run", step.script], {
      cwd: ROOT,
      stdio: "inherit",
      // Matches `scripts/verify.mjs`'s own reasoning: only `pnpm` needs shell/PATH
      // resolution on Windows.
      shell: isWindows,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);

    if (proc.status !== 0) {
      throw new Error(
        `E2E global setup failed at "${step.label}" (pnpm run ${step.script}, exit ` +
          `${String(proc.status)}, ${seconds}s). Fix the underlying seed/mint script and re-run — ` +
          "see its own output above for the real error.",
      );
    }
    console.info(`  ok   ${step.label}  (${seconds}s)`);
  }

  console.info("─".repeat(72));
  console.info("E2E global setup complete.");
  console.info("");
}
