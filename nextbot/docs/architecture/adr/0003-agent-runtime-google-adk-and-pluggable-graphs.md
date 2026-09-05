# ADR-0003 — Agent runtime on Google ADK TypeScript behind a pluggable `GraphRuntime` port

**Status:** Accepted · 2026-08-15
**Context refs:** spec §9.2, FR-AGT-01/02/03/09, FR-AI-02/03, NFR-2, NFR-12, data model `AgentDefinition.graph_type`

## 1. Context

Two requirements pull in opposite directions. §9.2 fixes **Google ADK TypeScript** as the concrete
MVP runtime. NFR-12 and the `AgentDefinition.graph_type` enum (`LangGraph | PydanticAI | ADK |
CustomFSM`) require that alternative orchestration frameworks be addable "without core platform
redeployment". Additionally, FR-MCP-05 Tier-3 requires a run to suspend for an unbounded period
(hours or days) and resume on a different process — a property most agent frameworks do not provide
natively, since they assume a single in-process reasoning loop.

## 2. Decision

**A `GraphRuntime` port owned by NextBot; Google ADK is an adapter behind it, not the architecture.**

```
interface GraphRuntime {
  load(definition: AgentDefinition): CompiledGraph;
  start(input: RunInput, ctx: RunContext): AsyncIterable<RunEvent>;
  resume(runId, checkpoint: RunCheckpoint, resolution: PendingResolution): AsyncIterable<RunEvent>;
}
```

Three rules make the port real rather than decorative:

1. **NextBot owns the run state machine, not the framework.** The `run-orchestrator` module owns the
   durable run record and the `queued → running → awaiting_customer | awaiting_approval |
   awaiting_human → completed | failed` transitions (ADR-0005). The graph framework is invoked to
   produce the *next* step and its emitted events; it is never the system of record for whether a
   run is alive. This is what makes suspend/resume work regardless of framework.
2. **NextBot owns tool resolution, model access, and policy.** ADK is given tool *handles* whose
   implementation posts a `ToolInvocation` to the Gateway Plane (ADR-0004), and a model client that
   is the Model Gateway (ADR-0006). ADK never sees a URL, a credential, a vendor model id, or an MCP
   transport. Tool *filtering* by visibility/policy/breaker state happens before the tool list is
   handed to ADK, so the model is never shown a tool it may not call.
3. **`RunEvent` is a NextBot type, not an ADK type.** Token deltas, tool-call intents, reasoning
   blocks, confidence, and cost are normalised at the adapter boundary, so the Trace Viewer,
   observability spans, and SSE streaming are framework-independent.

**Selection is per Agent Definition,** keyed on `graph_type`, resolved from a registry map at run
start. Adding a graph type is a new adapter package plus a registry entry — no change to the
orchestrator, the gateway, or the schema.

**A second implementation is kept in-tree from Phase 1**: a trivial deterministic `CustomFSM`
runtime used by tests and the sandbox simulator. Its purpose is to prove continuously that no
ADK-specific concept has leaked past the adapter. If the FSM runtime stops compiling or stops
passing the shared runtime conformance suite, the abstraction has been violated and CI fails.

## 3. Alternatives considered

**Use ADK directly, abstract later.** Rejected. "Abstract later" fails specifically here because the
leak surface (tool definitions, model client, run state, event shapes) is exactly the surface that
every other plane consumes; by the time a second framework is wanted, the Trace Viewer, the approval
engine, and the observability schema would all be shaped by ADK's internals.

**A generic in-house orchestration engine, ADK used only for LLM plumbing.** Rejected as
over-engineering: it discards the framework's value (tool-calling loop, streaming, session handling)
while owning its hardest bugs.

**Run each graph type as a separate deployable.** Rejected: no requirement forces it, and it would
multiply the deployment topology per framework.

## 4. Consequences

- The ADK adapter is the only place `@google/adk` may be imported; enforced by the same lint rule
  family as the provider-SDK ban (HLD §6).
- ADK is pinned to an exact version; its release notes are watched as a maintenance task, since the
  TypeScript line is younger than the Python one.
- Some ADK conveniences (its own session/memory services, its own callback hooks) are deliberately
  unused where they would duplicate NextBot state; the LLD should state which ADK subsystems are
  in-use and which are bypassed, so developers do not reintroduce them piecemeal.
- FR-AGT-03's chat-driven builder and the visual designer both emit the same `AgentDefinition` YAML
  artifact; neither generates framework-specific code, which keeps the pluggability claim honest.

## 5. Risks

- ADK TypeScript API churn. Mitigated by the port + exact pinning + the conformance suite.
- Streaming-first-token latency (NFR-2, 2.5 s median) depends on ADK's streaming path being
  pass-through. The adapter must stream deltas as they arrive, never buffer a full completion; this
  is asserted by a latency test in CI, not left to inspection.
