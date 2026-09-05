import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startScheduler } from "./scheduler.js";

describe("startScheduler (Phase 18, apps/worker's first real job scheduler)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs each job once immediately at startup", async () => {
    const run = vi.fn().mockResolvedValue({ ok: true });
    startScheduler([{ name: "test-job", intervalMs: 60_000, run }]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
  });

  it("re-runs a job on its own interval", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    startScheduler([{ name: "test-job", intervalMs: 1000, run }]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("one job's rejection never stops another job's schedule", async () => {
    const failing = vi.fn().mockRejectedValue(new Error("boom"));
    const healthy = vi.fn().mockResolvedValue(undefined);
    startScheduler([
      { name: "failing", intervalMs: 1000, run: failing },
      { name: "healthy", intervalMs: 1000, run: healthy },
    ]);
    await vi.waitFor(() => expect(healthy).toHaveBeenCalledTimes(1));
    await vi.advanceTimersByTimeAsync(1000);
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(failing).toHaveBeenCalledTimes(2);
  });

  it("stop() halts every job's schedule", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const schedule = startScheduler([{ name: "test-job", intervalMs: 1000, run }]);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    schedule.stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
