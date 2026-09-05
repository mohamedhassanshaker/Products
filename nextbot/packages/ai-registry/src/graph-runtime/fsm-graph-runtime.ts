import { generateTextOverChain, resolveModel, type ResolvedChainEntry } from "../registry.js";
import type { LogicalModelName } from "../config.js";
import {
  CONFORMANCE_PENDING_APPROVAL_TRIGGER,
  type AgentGraphDefinition,
  type CompiledGraph,
  type GraphRuntime,
  type PendingResolution,
  type RunContext,
  type RunCheckpoint,
  type RunEvent,
  type RunInput,
} from "./types.js";

interface FsmHandle {
  definition: AgentGraphDefinition;
}

interface FsmCheckpoint extends RunCheckpoint {
  history: Array<{ role: "user" | "assistant"; content: string }>;
  pendingCallId?: string;
  pendingToolName?: string;
}

/**
 * ADR-0003's **second, in-tree** `GraphRuntime` implementation — "a trivial
 * deterministic `CustomFSM` runtime used by tests and the sandbox simulator... to
 * prove continuously that no ADK-specific concept has leaked past the adapter."
 * It is deliberately simple: one model call per turn (no multi-step tool-calling
 * loop, no streaming token-by-token — `Final` carries the whole response at once),
 * but implements the full `GraphRuntime` contract for real, including genuine
 * suspend/resume via `agent_run`-shaped checkpoints (the same shape the ADK adapter
 * produces, proven by the shared conformance suite in `conformance-suite.ts`).
 */
export function createFsmGraphRuntime(opts?: { resolveChain?: (routeKey: string) => ResolvedChainEntry[] }): GraphRuntime {
  const resolveChain = opts?.resolveChain ?? ((routeKey: string) => [resolveModel(routeKey as LogicalModelName)]);

  return {
    load(definition: AgentGraphDefinition): CompiledGraph {
      return { graphType: "CustomFSM", handle: { definition } satisfies FsmHandle };
    },

    async *start(compiled: CompiledGraph, input: RunInput, _ctx: RunContext): AsyncIterable<RunEvent> {
      const { definition } = compiled.handle as FsmHandle;
      const history: FsmCheckpoint["history"] = [{ role: "user", content: input.text }];

      // Test-only deterministic pause trigger (see types.ts doc) — a NextBot-level
      // suspend/resume proof independent of any model's own tool-call decision.
      if (input.text === CONFORMANCE_PENDING_APPROVAL_TRIGGER) {
        const callId = "fsm-test-call-1";
        yield { type: "ToolCallRequested", callId, toolName: "test_tool", args: {} };
        yield { type: "PendingApproval", callId, toolName: "test_tool", args: {} };
        yield { type: "Checkpoint", checkpoint: { history, pendingCallId: callId, pendingToolName: "test_tool" } satisfies FsmCheckpoint };
        return;
      }

      const chain = resolveChain(definition.modelRouteKey);
      const result = await generateTextOverChain(chain, definition.modelRouteKey, {
        system: definition.instructions,
        messages: history,
      });
      yield { type: "TextDelta", text: result.text };
      yield { type: "Final", text: result.text };
    },

    async *resume(compiled: CompiledGraph, checkpoint: RunCheckpoint, resolution: PendingResolution, _ctx: RunContext): AsyncIterable<RunEvent> {
      const { definition } = compiled.handle as FsmHandle;
      const cp = checkpoint as FsmCheckpoint;
      if (cp.pendingCallId && cp.pendingCallId !== resolution.callId) {
        yield { type: "Error", message: `resume() called with callId '${resolution.callId}' but the checkpoint is paused on '${cp.pendingCallId}'` };
        return;
      }

      yield { type: "ToolCallResult", callId: resolution.callId, result: resolution.result };

      const history = [...(cp.history ?? []), { role: "user" as const, content: `Tool result: ${JSON.stringify(resolution.result)}` }];
      const chain = resolveChain(definition.modelRouteKey);
      const result = await generateTextOverChain(chain, definition.modelRouteKey, {
        system: definition.instructions,
        messages: history,
      });
      yield { type: "TextDelta", text: result.text };
      yield { type: "Final", text: result.text };
    },
  };
}
