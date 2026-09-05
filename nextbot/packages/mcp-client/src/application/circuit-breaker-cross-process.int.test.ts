import { describe, expect, it, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBreakerOpen, __resetBreakerStateForTests } from "./circuit-breaker.js";
import { _resetBreakerRedisClientForTests } from "./redis-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

afterEach(async () => {
  await __resetBreakerStateForTests();
  await _resetBreakerRedisClientForTests();
});

/**
 * Phase 18 (BL-11) — the cross-process gap this dispatch's gotcha list explicitly
 * calls out: a Phase 14/16 in-memory breaker would never satisfy this test, since
 * an in-process `Map` in one Node process is invisible to another. This spawns a
 * genuinely separate OS process (`node` running `record-breaker-failure.mjs`,
 * not merely a `vi.resetModules()` reset within the same test process) that trips
 * the breaker for `(tenant, tool)`, then asserts *this* test process — a third,
 * independent process context — observes the trip via the same shared Redis
 * instance, proving real cross-process state.
 */
describe("circuit breaker cross-process state (Phase 18, real Redis, real separate OS process)", () => {
  it("a breaker tripped by a separate child process is observed as open by this process", async () => {
    const tenantId = "cross-process-test-tenant";
    const toolId = "cross-process-test-tool";

    const scriptPath = path.join(__dirname, "__fixtures__", "trip-breaker-in-child-process.ts");
    // Resolved to this *package's own* local `tsx` binary (pnpm's isolated
    // node_modules means `npx tsx` cannot reliably resolve it from an arbitrary
    // cwd) — still a genuinely separate OS process from this test's own.
    const tsxBin = path.join(__dirname, "..", "..", "node_modules", ".bin", process.platform === "win32" ? "tsx.CMD" : "tsx");
    execFileSync(tsxBin, [scriptPath, tenantId, toolId], {
      env: { ...process.env, NEXTBOT_DB_ENV: "test" },
      stdio: "inherit",
      shell: true,
    });

    expect(await isBreakerOpen(tenantId, toolId)).toBe(true);
  }, 20_000);
});
