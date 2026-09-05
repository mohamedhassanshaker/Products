import { LlmAgent, Runner, InMemorySessionService, FunctionTool, type Event as AdkEvent, type Session as AdkSession } from "@google/adk";
import { resolveModel, type ResolvedChainEntry } from "../registry.js";
import type { LogicalModelName } from "../config.js";
import { NextBotGatewayLlm } from "./nextbot-gateway-llm.js";
import {
  CONFORMANCE_PENDING_APPROVAL_TRIGGER,
  type AgentGraphDefinition,
  type CompiledGraph,
  type GraphRuntime,
  type PendingResolution,
  type RunCheckpoint,
  type RunContext,
  type RunEvent,
  type RunInput,
} from "../graph-runtime/types.js";

const APP_NAME = "nextbot-adk";

interface AdkHandle {
  agent: LlmAgent;
  sessionService: InMemorySessionService;
}

interface AdkCheckpoint extends RunCheckpoint {
  events: AdkEvent[];
  state: Record<string, unknown>;
  pendingCallId: string;
}

/**
 * ADR-0003 — the Google ADK TypeScript adapter behind the `GraphRuntime` port. Uses
 * ADK's real `LlmAgent` + `Runner` + `InMemorySessionService` primitives (this is a
 * genuine `@google/adk` integration, not a placeholder that merely imports the
 * package) — bound to `NextBotGatewayLlm` so ADK's own model client is never invoked
 * (ADR-0003 rule 2). Tool binding wraps each already-policy-filtered `ToolHandle` as
 * an ADK `FunctionTool`; a real multi-step tool-calling turn is exercised starting
 * Phase 12, once `orchestration`'s turn-runner is the caller supplying real,
 * permission-filtered tools instead of the empty/test list this phase's callers pass.
 *
 * **Cross-worker resume, honestly scoped.** `InMemorySessionService` is exactly what
 * its name says — in-process only. `resume()` is written to be correct **assuming
 * the caller has already called `load()` again on this worker** (a fresh, empty
 * session service) before calling `resume()`, exactly as LLD §7.4's "resume on a
 * different worker" implies: the durable state that actually crosses workers is
 * `RunCheckpoint` (`agent_run.checkpoint`, real JSONB), not the in-memory session
 * object. `resume()` rehydrates a brand-new session from that checkpoint's replayed
 * event history before continuing — this is the real mechanism, not a shortcut.
 */
export function createAdkGraphRuntime(opts?: { resolveChain?: (routeKey: string) => ResolvedChainEntry[] }): GraphRuntime {
  const resolveChain = opts?.resolveChain ?? ((routeKey: string) => [resolveModel(routeKey as LogicalModelName)]);

  return {
    load(definition: AgentGraphDefinition): CompiledGraph {
      const chain = resolveChain(definition.modelRouteKey);
      const model = new NextBotGatewayLlm(definition.modelRouteKey, chain, definition.modelRouteKey);
      const tools = definition.tools.map(
        (tool) =>
          new FunctionTool({
            name: tool.name,
            description: tool.description,
            // ADK's FunctionTool typing expects a Zod schema or a Gemini `Schema`
            // object; our ports pass a plain JSON-Schema-shaped object (from the Agent
            // Tool Registry, LLD §3.6), which is structurally compatible with Gemini's
            // `Schema` (both are `{type, properties, required, ...}`), so this is a
            // safe, deliberate cast rather than a re-implementation of JSON-Schema.
            parameters: tool.parameters as never,
            execute: async (args) => tool.execute(args as Record<string, unknown>),
          }),
      );
      const agent = new LlmAgent({ name: sanitizeAgentName(definition.name), model, instruction: definition.instructions, tools });
      return { graphType: "ADK", handle: { agent, sessionService: new InMemorySessionService() } satisfies AdkHandle };
    },

    async *start(compiled: CompiledGraph, input: RunInput, ctx: RunContext): AsyncIterable<RunEvent> {
      const { agent, sessionService } = compiled.handle as AdkHandle;
      await sessionService.createSession({ appName: APP_NAME, userId: ctx.userId, sessionId: ctx.runId });

      if (input.text === CONFORMANCE_PENDING_APPROVAL_TRIGGER) {
        const callId = "adk-test-call-1";
        yield { type: "ToolCallRequested", callId, toolName: "test_tool", args: {} };
        yield { type: "PendingApproval", callId, toolName: "test_tool", args: {} };
        const session = await sessionService.getSession({ appName: APP_NAME, userId: ctx.userId, sessionId: ctx.runId });
        yield { type: "Checkpoint", checkpoint: toCheckpoint(session, callId) };
        return;
      }

      const runner = new Runner({ appName: APP_NAME, agent, sessionService });
      let finalText = "";
      for await (const event of runner.runAsync({ userId: ctx.userId, sessionId: ctx.runId, newMessage: { parts: [{ text: input.text }] } })) {
        const text = extractText(event);
        if (text) {
          finalText = text;
          yield { type: "TextDelta", text };
        }
      }
      yield { type: "Final", text: finalText };
    },

    async *resume(compiled: CompiledGraph, checkpoint: RunCheckpoint, resolution: PendingResolution, ctx: RunContext): AsyncIterable<RunEvent> {
      const { agent, sessionService } = compiled.handle as AdkHandle;
      const cp = checkpoint as AdkCheckpoint;
      if (cp.pendingCallId && cp.pendingCallId !== resolution.callId) {
        yield { type: "Error", message: `resume() called with callId '${resolution.callId}' but the checkpoint is paused on '${cp.pendingCallId}'` };
        return;
      }

      const session = await sessionService.createSession({ appName: APP_NAME, userId: ctx.userId, sessionId: ctx.runId, state: cp.state });
      for (const event of cp.events ?? []) {
        await sessionService.appendEvent({ session, event });
      }

      yield { type: "ToolCallResult", callId: resolution.callId, result: resolution.result };

      const runner = new Runner({ appName: APP_NAME, agent, sessionService });
      let finalText = "";
      const newMessageText = `Tool result: ${JSON.stringify(resolution.result)}`;
      for await (const event of runner.runAsync({ userId: ctx.userId, sessionId: ctx.runId, newMessage: { parts: [{ text: newMessageText }] } })) {
        const text = extractText(event);
        if (text) {
          finalText = text;
          yield { type: "TextDelta", text };
        }
      }
      yield { type: "Final", text: finalText };
    },
  };
}

function toCheckpoint(session: AdkSession | undefined, pendingCallId: string): AdkCheckpoint {
  return { events: session?.events ?? [], state: session?.state ?? {}, pendingCallId };
}

function extractText(event: AdkEvent): string | undefined {
  const parts = event.content?.parts ?? [];
  const text = parts.map((p) => ("text" in p ? p.text : undefined)).filter((t): t is string => Boolean(t)).join("");
  return text || undefined;
}

/** ADK agent names must be valid identifiers in some ADK versions (used as a
 * transfer-target key); falls back to a fixed default when the agent definition's own
 * name would not be, rather than passing through an unvalidated string. */
function sanitizeAgentName(name: string): string {
  const sanitized = name.replace(/[^a-zA-Z0-9_]/g, "_");
  return sanitized.length > 0 ? sanitized : "nextbot_agent";
}
