import { describe, expect, it } from "vitest";
import { CONFORMANCE_PENDING_APPROVAL_TRIGGER, type GraphRuntime, type RunCheckpoint, type RunEvent } from "./types.js";

async function collect(iter: AsyncIterable<RunEvent>): Promise<RunEvent[]> {
  const events: RunEvent[] = [];
  for await (const event of iter) events.push(event);
  return events;
}

/**
 * ADR-0003: "a trivial deterministic `CustomFSM` runtime... prove[s] continuously
 * that no ADK-specific concept has leaked past the adapter. If the FSM runtime stops
 * compiling or stops passing the shared runtime conformance suite, the abstraction
 * has been violated and CI fails." This is that suite — run against **every**
 * `GraphRuntime` implementation (both `createFsmGraphRuntime()` and
 * `createAdkGraphRuntime()`) from a real `*.test.ts` file, so a genuine port-shape
 * regression in either adapter fails CI regardless of which one drifted.
 *
 * Deliberately exercises only the structural suspend/resume contract (the
 * `CONFORMANCE_PENDING_APPROVAL_TRIGGER` path, which every adapter recognizes
 * identically and deterministically, independent of any model's own tool-selection
 * behavior) — a real model-driven multi-step tool-calling turn is Phase 12 scope, once
 * `orchestration` is the caller supplying real tools and a live model chain. The
 * `resume()` case *does* still make one real model call afterward (producing the
 * `Final` response that follows the tool result) — callers of this suite inject a
 * `resolveChain` pointed at a local mock provider server so that call is real but
 * needs no live credential (see `fsm-graph-runtime.int.test.ts`/
 * `adk-graph-runtime.int.test.ts`).
 */
export function runGraphRuntimeConformanceSuite(name: string, createRuntime: () => GraphRuntime): void {
  describe(`GraphRuntime conformance suite — ${name}`, () => {
    it("load() returns a CompiledGraph carrying the expected graphType", () => {
      const runtime = createRuntime();
      const compiled = runtime.load({ name: "conformance-agent", instructions: "You are a test agent.", modelRouteKey: "chat.primary", tools: [] });
      expect(compiled.graphType).toBeTruthy();
      expect(compiled.handle).toBeDefined();
    });

    it("start() suspends on the structural pending-approval trigger and yields a persistable Checkpoint", async () => {
      const runtime = createRuntime();
      const compiled = runtime.load({ name: "conformance-agent", instructions: "You are a test agent.", modelRouteKey: "chat.primary", tools: [] });
      const events = await collect(
        runtime.start(compiled, { text: CONFORMANCE_PENDING_APPROVAL_TRIGGER }, { runId: "run-1", tenantId: "t1", userId: "u1" }),
      );

      const toolCallRequested = events.find((e) => e.type === "ToolCallRequested");
      const pendingApproval = events.find((e) => e.type === "PendingApproval");
      const checkpointEvent = events.find((e) => e.type === "Checkpoint");
      expect(toolCallRequested, "expected a ToolCallRequested event before pausing").toBeDefined();
      expect(pendingApproval, "expected a PendingApproval event").toBeDefined();
      expect(checkpointEvent, "expected a Checkpoint event carrying persistable state").toBeDefined();
      // A paused run must not have already produced a Final event — that would defeat
      // the entire non-blocking-suspension guarantee (LLD §3.10 / ADR-0005).
      expect(events.some((e) => e.type === "Final")).toBe(false);
    });

    it("resume() with the matching callId continues the run and yields Final, using a freshly load()-ed graph (proving the checkpoint alone carries the resumable state, not in-process affinity)", async () => {
      const runtime = createRuntime();
      const firstCompiled = runtime.load({ name: "conformance-agent", instructions: "You are a test agent.", modelRouteKey: "chat.primary", tools: [] });
      const startEvents = await collect(
        runtime.start(firstCompiled, { text: CONFORMANCE_PENDING_APPROVAL_TRIGGER }, { runId: "run-2", tenantId: "t1", userId: "u1" }),
      );
      const checkpointEvent = startEvents.find((e) => e.type === "Checkpoint");
      if (!checkpointEvent || checkpointEvent.type !== "Checkpoint") throw new Error("test setup failed: no Checkpoint event");
      const pendingApproval = startEvents.find((e) => e.type === "PendingApproval");
      if (!pendingApproval || pendingApproval.type !== "PendingApproval") throw new Error("test setup failed: no PendingApproval event");

      // A round trip through JSON proves the checkpoint is genuinely serializable
      // (it is stored in a real `jsonb` column, LLD §3.10) rather than an in-memory
      // object graph that merely happens to work when reused directly.
      const serializedCheckpoint: RunCheckpoint = JSON.parse(JSON.stringify(checkpointEvent.checkpoint));

      // A fresh load() — a different worker/process would do exactly this, since it
      // has no access to the first worker's in-memory graph handle at all.
      const secondCompiled = runtime.load({ name: "conformance-agent", instructions: "You are a test agent.", modelRouteKey: "chat.primary", tools: [] });
      const resumeEvents = await collect(
        runtime.resume(
          secondCompiled,
          serializedCheckpoint,
          { callId: pendingApproval.callId, result: { ok: true } },
          { runId: "run-2", tenantId: "t1", userId: "u1" },
        ),
      );

      expect(resumeEvents.some((e) => e.type === "ToolCallResult")).toBe(true);
      expect(resumeEvents.some((e) => e.type === "Final")).toBe(true);
      expect(resumeEvents.some((e) => e.type === "Error")).toBe(false);
    });

    it("resume() rejects a resolution whose callId does not match the checkpoint's paused call", async () => {
      const runtime = createRuntime();
      const compiled = runtime.load({ name: "conformance-agent", instructions: "You are a test agent.", modelRouteKey: "chat.primary", tools: [] });
      const startEvents = await collect(
        runtime.start(compiled, { text: CONFORMANCE_PENDING_APPROVAL_TRIGGER }, { runId: "run-3", tenantId: "t1", userId: "u1" }),
      );
      const checkpointEvent = startEvents.find((e) => e.type === "Checkpoint");
      if (!checkpointEvent || checkpointEvent.type !== "Checkpoint") throw new Error("test setup failed: no Checkpoint event");

      const resumeEvents = await collect(
        runtime.resume(compiled, checkpointEvent.checkpoint, { callId: "wrong-call-id", result: {} }, { runId: "run-3", tenantId: "t1", userId: "u1" }),
      );
      expect(resumeEvents.some((e) => e.type === "Error")).toBe(true);
      expect(resumeEvents.some((e) => e.type === "Final")).toBe(false);
    });
  });
}
