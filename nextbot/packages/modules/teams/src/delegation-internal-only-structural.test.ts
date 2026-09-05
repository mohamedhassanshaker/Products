import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * Target Architecture Blueprint Phase 14 (BL-46, LLD §14.7.4) — the STRUCTURAL half
 * of "delegation is internal-only".
 *
 * `delegation_event.reason` (the supervisor's routing rationale) must be
 * unreachable from any customer-visible surface **by construction, not merely
 * untested**. The widget-facing DTO mappers live in `conversations`, so the
 * guarantee is expressed as a `conversations -> teams` prohibition in
 * `.dependency-cruiser.cjs` (`no-teams-inside-conversations`) — the same shape as
 * `no-neo4j-driver-outside-graph-store` and
 * `no-raw-authz-evaluate-outside-authz`.
 *
 * A rule nobody has ever seen fail is not a guarantee, so this test DELIBERATELY
 * introduces the forbidden import into a throwaway file inside `conversations`,
 * runs the real dependency-cruiser, asserts it fails by name, and removes the file
 * again. Mirrors `eslint.boundaries.test.ts`'s own "prove the gate actually bites"
 * approach.
 */
const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PROBE_DIR = path.join(REPO_ROOT, "packages", "modules", "conversations", "src", "__structural_probe__");
const PROBE_FILE = path.join(PROBE_DIR, "widget-dto-probe.ts");

/**
 * Runs the REAL dependency-cruiser against the REAL `.dependency-cruiser.cjs`,
 * exactly as `pnpm lint:boundaries` does — invoking its CLI entry point through
 * `node` rather than through a shell shim, so this behaves identically on every
 * platform the repo is developed on.
 */
const CRUISER_CLI = path.join(REPO_ROOT, "node_modules", "dependency-cruiser", "bin", "dependency-cruise.mjs");

function cruise(): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [CRUISER_CLI, "--config", ".dependency-cruiser.cjs", "--output-type", "err", "packages/modules/conversations"],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? 1, output: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("LLD §14.7.4 — `conversations` must not be able to import `teams` (structural, not merely untested)", () => {
  afterEach(() => {
    rmSync(PROBE_DIR, { recursive: true, force: true });
  });

  it("dependency-cruiser is CLEAN for `conversations` as the codebase actually stands", () => {
    const { code } = cruise();
    expect(code).toBe(0);
  }, 180_000);

  it("…and produces a real `no-teams-inside-conversations` violation the moment the forbidden import is introduced", () => {
    mkdirSync(PROBE_DIR, { recursive: true });
    // Exactly the mistake the rule exists to prevent: a widget-facing DTO mapper
    // reaching for a delegation field.
    writeFileSync(
      PROBE_FILE,
      [
        "// TEMPORARY probe file written by delegation-internal-only-structural.test.ts.",
        "// Deleted in the test's own afterEach. If you are reading this in a diff,",
        "// something crashed mid-test — delete it.",
        // A DEEP RELATIVE import, deliberately: it is the sneakier form of the
        // violation (it resolves purely by path, so it slips past the
        // package-granularity eslint-plugin-boundaries allow-list entirely) and is
        // precisely the case dependency-cruiser's file-path rules exist to catch.
        // A bare `@nextbot/teams` specifier would not even resolve from here —
        // `teams` is not a dependency of `conversations` — so it would produce an
        // unresolvable edge rather than exercise the rule.
        'import { buildDelegationChainForRun } from "../../../teams/src/index.js";',
        "export const leak = buildDelegationChainForRun;",
        "",
      ].join("\n"),
      "utf8",
    );

    const { code, output } = cruise();
    expect(code).not.toBe(0);
    expect(output).toContain("no-teams-inside-conversations");
  }, 180_000);
});
