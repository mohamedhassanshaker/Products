import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Thin `http/` delegation checks for the durable-execution half (Target Architecture
 * Blueprint Phase 16, BL-47b, LLD §14.6.5). Every handler is a pure adapter onto an
 * application-layer function, so what is worth asserting here is that it calls the right
 * one with the right arguments — the behaviour itself is covered by the real-Postgres
 * integration suites. Mirrors `http/admin-routes.test.ts`'s own convention exactly.
 *
 * The one place these handlers do more than delegate is query/param NORMALIZATION, and
 * that IS asserted: an optional filter must be omitted rather than forwarded as
 * `undefined`, because a repository that receives `{ state: undefined }` and one that
 * receives `{}` are the same only by accident.
 */

const startSandboxRunMock = vi.fn();
const listRunsMock = vi.fn();
const getRunWithTraceMock = vi.fn();
const cancelRunMock = vi.fn();
const resumeRunMock = vi.fn();
const handleWebhookTriggerMock = vi.fn();
const toRunDtoMock = vi.fn((run: unknown) => ({ dto: run }));

vi.mock("../application/run-service.js", () => ({
  startSandboxRun: (...args: unknown[]) => startSandboxRunMock(...args),
  listRuns: (...args: unknown[]) => listRunsMock(...args),
  getRunWithTrace: (...args: unknown[]) => getRunWithTraceMock(...args),
  cancelRun: (...args: unknown[]) => cancelRunMock(...args),
  resumeRun: (...args: unknown[]) => resumeRunMock(...args),
  handleWebhookTrigger: (...args: unknown[]) => handleWebhookTriggerMock(...args),
  toRunDto: (run: unknown) => toRunDtoMock(run),
}));

const CTX = { tenantId: "t1", region: "US" as const, environment: "Sandbox" as const };
const SECRETS = { async resolve() { return "secret"; } };

beforeEach(() => {
  vi.clearAllMocks();
  toRunDtoMock.mockImplementation((run: unknown) => ({ dto: run }));
});

describe("handleStartSandboxRun", () => {
  it("passes the REQUIRED Idempotency-Key straight through and reports whether the run was created", async () => {
    const { handleStartSandboxRun } = await import("./run-routes.js");
    startSandboxRunMock.mockResolvedValue({ run: { id: "r1" }, created: true });

    const result = await handleStartSandboxRun(CTX, "v1", "key-1", { input: { a: 1 } });

    expect(startSandboxRunMock).toHaveBeenCalledWith(CTX, "v1", "key-1", { input: { a: 1 } });
    expect(result).toEqual({ run: { dto: { id: "r1" } }, created: true });
  });

  it("omits absent optional body fields rather than forwarding undefined", async () => {
    const { handleStartSandboxRun } = await import("./run-routes.js");
    startSandboxRunMock.mockResolvedValue({ run: { id: "r1" }, created: false });

    await handleStartSandboxRun(CTX, "v1", "key-1", {});
    expect(startSandboxRunMock).toHaveBeenCalledWith(CTX, "v1", "key-1", {});
  });

  it("forwards a supplied conversationId, which is what lets a sandbox run exercise the Approval Queue path", async () => {
    const { handleStartSandboxRun } = await import("./run-routes.js");
    startSandboxRunMock.mockResolvedValue({ run: { id: "r1" }, created: true });

    await handleStartSandboxRun(CTX, "v1", "key-1", { conversationId: "c1" });
    expect(startSandboxRunMock).toHaveBeenCalledWith(CTX, "v1", "key-1", { conversationId: "c1" });
  });
});

describe("handleListWorkflowRuns", () => {
  it("normalizes every filter, omitting the absent ones", async () => {
    const { handleListWorkflowRuns } = await import("./run-routes.js");
    listRunsMock.mockResolvedValue([]);

    await handleListWorkflowRuns(CTX, { workflowId: "w1", state: "Running" });
    expect(listRunsMock).toHaveBeenCalledWith(CTX, { workflowId: "w1", state: "Running" });

    await handleListWorkflowRuns(CTX, {});
    expect(listRunsMock).toHaveBeenLastCalledWith(CTX, {});
  });

  it("parses `from`/`to` into real Dates, and passes cursor/limit through", async () => {
    const { handleListWorkflowRuns } = await import("./run-routes.js");
    listRunsMock.mockResolvedValue([]);

    await handleListWorkflowRuns(CTX, { from: "2026-01-01T00:00:00.000Z", to: "2026-02-01T00:00:00.000Z", cursor: "2026-01-15T00:00:00.000Z", limit: 25 });
    const call = listRunsMock.mock.calls.at(-1)![1] as { from: Date; to: Date; cursor: string; limit: number };
    expect(call.from).toBeInstanceOf(Date);
    expect(call.to.toISOString()).toBe("2026-02-01T00:00:00.000Z");
    expect(call.cursor).toBe("2026-01-15T00:00:00.000Z");
    expect(call.limit).toBe(25);
  });

  it("returns the last row's startedAt as the keyset cursor, and null on the final page", async () => {
    const { handleListWorkflowRuns } = await import("./run-routes.js");

    listRunsMock.mockResolvedValue([{ id: "a", startedAt: "T1" }, { id: "b", startedAt: "T2" }]);
    expect((await handleListWorkflowRuns(CTX, {})).nextCursor).toBe("T2");

    listRunsMock.mockResolvedValue([]);
    expect((await handleListWorkflowRuns(CTX, {})).nextCursor).toBeNull();
  });
});

describe("handleGetWorkflowRun", () => {
  it("delegates to getRunWithTrace, which returns {run, graph, steps} for the FR-WF-07 viewer", async () => {
    const { handleGetWorkflowRun } = await import("./run-routes.js");
    getRunWithTraceMock.mockResolvedValue({ run: {}, graph: {}, steps: [] });

    await handleGetWorkflowRun(CTX, "r1");
    expect(getRunWithTraceMock).toHaveBeenCalledWith(CTX, "r1");
  });
});

describe("handleCancelWorkflowRun", () => {
  it("takes the acting user from the CALLER (the session), never from the body", async () => {
    const { handleCancelWorkflowRun } = await import("./run-routes.js");
    cancelRunMock.mockResolvedValue({ id: "r1" });

    await handleCancelWorkflowRun(CTX, "r1", { reason: "stop" }, "user-9");
    expect(cancelRunMock).toHaveBeenCalledWith(CTX, "r1", "stop", "user-9");
  });

  it("forwards an absent reason as undefined rather than inventing one", async () => {
    const { handleCancelWorkflowRun } = await import("./run-routes.js");
    cancelRunMock.mockResolvedValue({ id: "r1" });

    await handleCancelWorkflowRun(CTX, "r1", {}, "user-9");
    expect(cancelRunMock).toHaveBeenCalledWith(CTX, "r1", undefined, "user-9");
  });
});

describe("handleResumeWorkflowRun", () => {
  it("delegates to the nudge — which executes nothing", async () => {
    const { handleResumeWorkflowRun } = await import("./run-routes.js");
    resumeRunMock.mockResolvedValue({ id: "r1", state: "Pending" });

    const result = await handleResumeWorkflowRun(CTX, "r1");
    expect(resumeRunMock).toHaveBeenCalledWith(CTX, "r1");
    expect(result).toEqual({ run: { dto: { id: "r1", state: "Pending" } } });
  });
});

describe("handleWorkflowWebhookTrigger", () => {
  it("returns ONLY the run id — an external caller has no business reading run state or cost", async () => {
    const { handleWorkflowWebhookTrigger } = await import("./run-routes.js");
    handleWebhookTriggerMock.mockResolvedValue({ run: { id: "r1", state: "Pending", costUsd: "0", triggerKind: "Webhook" }, created: true });

    const result = await handleWorkflowWebhookTrigger(CTX, SECRETS, { path: "p", rawBody: "{}", signature: "sig", idempotencyKey: null });

    expect(result).toEqual({ runId: "r1", accepted: true, created: true });
    expect(result).not.toHaveProperty("state");
    expect(result).not.toHaveProperty("costUsd");
  });

  it("passes the RAW body and signature through unchanged — the signature must cover the bytes received", async () => {
    const { handleWorkflowWebhookTrigger } = await import("./run-routes.js");
    handleWebhookTriggerMock.mockResolvedValue({ run: { id: "r1" }, created: false });
    const input = { path: "orders/created", rawBody: '{"a":1}', signature: "abc", idempotencyKey: "k" };

    await handleWorkflowWebhookTrigger(CTX, SECRETS, input);
    expect(handleWebhookTriggerMock).toHaveBeenCalledWith(CTX, SECRETS, input);
  });
});
