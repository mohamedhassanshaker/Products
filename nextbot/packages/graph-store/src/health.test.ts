import { describe, expect, it, vi } from "vitest";

const sessionRunMock = vi.fn();
const sessionCloseMock = vi.fn();
const sessionExecuteReadMock = vi.fn((fn: (tx: { run: typeof sessionRunMock }) => unknown) =>
  fn({ run: sessionRunMock }),
);

vi.mock("./driver.js", () => ({
  getAdminDriver: () => ({
    session: () => ({
      executeRead: sessionExecuteReadMock,
      close: sessionCloseMock,
    }),
  }),
}));

describe("checkGraphStoreHealth / assertGraphStoreHealthy", () => {
  it("returns ok:false with a detail message when the session throws (Neo4j unreachable)", async () => {
    sessionExecuteReadMock.mockRejectedValueOnce(new Error("connection refused"));
    sessionCloseMock.mockResolvedValueOnce(undefined);
    const { checkGraphStoreHealth } = await import("./health.js");
    const result = await checkGraphStoreHealth();
    expect(result.ok).toBe(false);
    expect(result.detail).toBe("connection refused");
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("swallows a failure to close an already-broken session without masking the health result", async () => {
    sessionExecuteReadMock.mockRejectedValueOnce(new Error("connection refused"));
    sessionCloseMock.mockRejectedValueOnce(new Error("cannot close a dead connection"));
    const { checkGraphStoreHealth } = await import("./health.js");
    const result = await checkGraphStoreHealth();
    expect(result.ok).toBe(false);
  });

  it("assertGraphStoreHealthy() throws GraphStoreUnavailableError when unhealthy", async () => {
    sessionExecuteReadMock.mockRejectedValueOnce(new Error("connection refused"));
    sessionCloseMock.mockResolvedValueOnce(undefined);
    const { assertGraphStoreHealthy } = await import("./health.js");
    const { GraphStoreUnavailableError } = await import("./errors.js");
    await expect(assertGraphStoreHealthy()).rejects.toThrow(GraphStoreUnavailableError);
  });

  it("assertGraphStoreHealthy() resolves silently when healthy", async () => {
    sessionExecuteReadMock.mockResolvedValueOnce(undefined);
    sessionCloseMock.mockResolvedValueOnce(undefined);
    const { assertGraphStoreHealthy } = await import("./health.js");
    await expect(assertGraphStoreHealthy()).resolves.toBeUndefined();
  });
});
