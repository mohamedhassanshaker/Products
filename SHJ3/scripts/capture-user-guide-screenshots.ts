/**
 * Captures one real screenshot per user-guide entry, against the real running app, using the
 * project's real Playwright infrastructure (`e2e/support/mint-session.ts`'s pre-minted
 * sessions, `playwright.config.ts`'s own client-binding pin) — never a placeholder image.
 *
 *   pnpm run userguide:screenshots
 *
 * This is the "kept current with the UI" mechanism CLAUDE.md's Phase F spec requires:
 * re-run it whenever a documented screen's real UI changes, and every screenshot under
 * `apps/web/public/user-guide/screenshots/` is regenerated from the real, live page.
 *
 * ## Prerequisites (checked, not silently assumed)
 *
 *  - The four store containers running (`docker compose up -d sqlserver redis neo4j
 *    qdrant`) — this script does not manage their lifecycle, the same reason
 *    `playwright.config.ts`'s own `webServer` doesn't either (shared, long-lived, owned by
 *    whatever the developer already has running).
 *  - `next dev` (or an equivalent server) reachable at `PLAYWRIGHT_BASE_URL` (default
 *    `http://localhost:3000`) — checked via `/api/healthz` before anything else runs, with a
 *    clear, actionable error rather than a confusing Playwright navigation timeout.
 *
 * ## Seeding is real and automatic, not assumed present
 *
 * Mirrors `e2e/global-setup.ts`'s own five-step chain exactly (same steps, same order, same
 * "safe to re-run" idempotency this file already documents) — a screenshot pass should not
 * require a developer to have already run the E2E suite first just to get `e2e/.auth/*.json`
 * to exist.
 *
 * ## The client-binding fidelity gap — `tasks/lessons.md`'s repeated finding, applied a
 * ## fourth time, to a NEW consumer of the same pre-minted cookies
 *
 * `e2e/.auth/super-admin.json`'s cookie is bound (`bindingMatches()`, `domain/session.ts`) to
 * the exact `(userAgent, ip)` pair `mint-e2e-sessions.ts` minted it with —
 * `mint-session.ts`'s own `E2E_USER_AGENT` and `PLAYWRIGHT_CLIENT_IP` (now both exported
 * specifically so this script can reuse them verbatim rather than retyping the literals and
 * risking exactly the drift this project's own lessons file warns about). This context sets
 * both the browser's `userAgent` *and* an explicit `x-forwarded-for` extra header — omitting
 * either would reproduce the "session destroyed on the first real request" false alarm this
 * project has now hit three times before finding the real cause.
 *
 * ## One screenshot per guide entry, not per (entry × locale)
 *
 * CLAUDE.md's Phase F spec asks for "a screenshot of the page" per entry, singular — not a
 * screenshot per locale. English is captured (the base locale every entry's own EN content
 * describes); Arabic/RTL correctness is instead proven by the live browser check in this
 * wave's verification pass (real Arabic prose rendering with real `dir="rtl"`), not by a
 * doubled screenshot set. Revisit if a later requirement genuinely needs a per-locale image.
 *
 * ## Route selection per entry
 *
 * `GUIDE_REGISTRY.coversRoutes` can name more than one URL (e.g. `agents/wizard` covers both
 * `/agents/new` and `/agents/[id]/edit`) — this script always captures the first
 * *statically-resolvable* one (no `[...]` dynamic segment), since resolving a real dynamic
 * id would need this script to also know a real seeded row's id per entry, a second real
 * dependency this pass does not need: every dynamic-segment route in `GUIDE_REGISTRY` today
 * has a static sibling covering the identical screen (`/agents/new` for the wizard).
 */

import { mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "@playwright/test";
import { GUIDE_REGISTRY } from "../apps/web/src/modules/userguide/domain/guide-registry.js";
import { E2E_USER_AGENT, PLAYWRIGHT_CLIENT_IP } from "../e2e/support/mint-session.js";

const ROOT = resolve(import.meta.dirname, "..");
const OUT_DIR = resolve(ROOT, "apps/web/public/user-guide/screenshots");
const STORAGE_STATE = resolve(ROOT, "e2e/.auth/super-admin.json");
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const isWindows = process.platform === "win32";

/** Mirrors `e2e/global-setup.ts`'s own SETUP_STEPS exactly — see that file for why this order and why each step is safe to re-run. */
const SEED_STEPS: readonly string[] = [
  "db:seed:iam",
  "db:seed:agents",
  "db:seed:appearance",
  "db:seed:e2e-credentials",
  "db:seed:e2e-sessions",
];

function firstStaticRoute(coversRoutes: readonly string[]): string {
  const staticRoute = coversRoutes.find((route) => !route.includes("["));
  if (!staticRoute) {
    throw new Error(
      `[capture-user-guide-screenshots] every route in coversRoutes (${coversRoutes.join(", ")}) ` +
        "has a dynamic segment — this script only knows how to resolve a static route. Add a " +
        "static sibling route to coversRoutes, or extend this script to resolve a real seeded id.",
    );
  }
  return staticRoute;
}

/** `/widget` needs a real, seeded channel key to render its actual content rather than the "add ?channelKey=..." placeholder state. */
function urlFor(route: string): string {
  if (route === "/widget") return `${BASE_URL}/en${route}?channelKey=sewa.WebWidget`;
  return `${BASE_URL}/en${route}`;
}

async function ensureSeeded(): Promise<void> {
  if (existsSync(STORAGE_STATE)) {
    console.info(
      "  storageState already present — re-seeding anyway (idempotent, per e2e/global-setup.ts)",
    );
  }
  for (const script of SEED_STEPS) {
    const started = Date.now();
    const proc = spawnSync("pnpm", ["run", script], {
      cwd: ROOT,
      stdio: "inherit",
      shell: isWindows,
    });
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    if (proc.status !== 0) {
      throw new Error(
        `[capture-user-guide-screenshots] seed step "${script}" failed (${seconds}s).`,
      );
    }
    console.info(`  ok   ${script}  (${seconds}s)`);
  }
}

async function ensureServerReachable(): Promise<void> {
  const url = `${BASE_URL}/api/healthz`;
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  } catch (error) {
    throw new Error(
      `[capture-user-guide-screenshots] could not reach ${url} — is the app running? ` +
        `Start it with "pnpm --filter @shj3/web run dev" first. (${String(error)})`,
    );
  }
  if (!response.ok) {
    throw new Error(
      `[capture-user-guide-screenshots] ${url} responded ${String(response.status)}, not healthy.`,
    );
  }
}

async function main(): Promise<void> {
  console.info("");
  console.info("User-guide screenshot capture — real pages, real running app");
  console.info("─".repeat(72));

  await ensureServerReachable();
  console.info("  ok   server reachable");
  await ensureSeeded();

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  try {
    const baseContextOptions = {
      userAgent: E2E_USER_AGENT,
      extraHTTPHeaders: { "x-forwarded-for": PLAYWRIGHT_CLIENT_IP },
      viewport: { width: 1440, height: 900 },
      locale: "en-US",
    } as const;

    // Authenticated for every entry except `sign-in` — that page's own real,
    // documented behaviour (`sign-in/page.tsx`'s "Already signed in" doc comment)
    // redirects an already-authenticated visitor straight past the form (to
    // `/command-centre`), so capturing it with the same `storageState` every other
    // entry uses would silently screenshot the wrong page. Found live: the first
    // run of this fix captured `sign-in.png` as a pixel-identical copy of
    // `command-centre.png` — confirmed by reading the file, not assumed from the
    // route name.
    const authedContext = await browser.newContext({
      ...baseContextOptions,
      storageState: STORAGE_STATE,
    });
    const anonymousContext = await browser.newContext(baseContextOptions);

    try {
      const authedPage = await authedContext.newPage();
      const anonymousPage = await anonymousContext.newPage();

      for (const entry of GUIDE_REGISTRY) {
        const route = firstStaticRoute(entry.coversRoutes);
        const url = urlFor(route);
        const outFile = resolve(OUT_DIR, `${entry.screenshotBaseName}.png`);
        const page = entry.slug === "sign-in" ? anonymousPage : authedPage;

        await page.goto(url, { waitUntil: "networkidle" });
        await page.screenshot({ path: outFile, fullPage: true });
        console.info(`  ok   ${entry.slug}  →  ${route}  →  ${outFile}`);
      }
    } finally {
      await authedContext.close();
      await anonymousContext.close();
    }
  } finally {
    await browser.close();
  }

  console.info("─".repeat(72));
  console.info(`Captured ${String(GUIDE_REGISTRY.length)} screenshots into ${OUT_DIR}`);
  console.info("");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
