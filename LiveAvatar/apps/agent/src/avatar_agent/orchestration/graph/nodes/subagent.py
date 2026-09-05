"""Sub-agent node executor (Phase 15, BL-058; `ARCHITECTURE_NOTES.md` §3.2)
— delegates one bounded LLM turn to another tenant's published persona
(`target_tenant_id`), lazily fetched and cached per session. Since this
codebase has no separate "Agent" entity (a tenant *is* the agent, 1:1, via
`DeploymentConfig`), "delegate to another agent" means delegate to another
tenant's published config by tenant id.

**v1 scope decision** (mirrors Phase 13's identical simplification for
`SkillNode` — see `nodes/skill.py`'s docstring, decision #1): delegation is
**one bounded LLM turn using the target tenant's persona/tools, never a
nested graph/interpreter invocation**. A full nested-sub-graph-per-tenant
delegation is a real, larger feature (its own node-id namespace, its own
budget accounting, its own nesting-depth guard one level down — V-3's
"sub-agent nesting <= 2" already anticipates recursion this v1 executor
never performs) — deferred as a named follow-up, not built here.

**Persona swap, not augmentation** — the one deliberate difference from
`SkillNodeExecutor`'s own "release on exit" discipline: a Skill node
*appends* its instructions onto the caller's own system prompt (the caller
is still the same agent, just briefly using an extra capability); a
Sub-agent node *replaces* the turn-local system prompt outright with the
target tenant's own `system_prompt` — the caller is handing the whole turn
to a genuinely different agent's persona, not augmenting its own. The
current turn's conversation messages/retrieved context are still carried
over (the delegate should see the live conversation), but `ctx.residency`
itself is never mutated — a fresh, turn-local `ResidencyPayload` is built
and discarded once the node returns, the exact same "release on exit"
property `skill.py`'s own docstring documents at length: `SessionMemory` is
never touched by any node executor, so the swapped-in persona structurally
cannot survive past this one node's own execution into any later turn.

**`handback_policy`** governs what happens to the delegated turn's own
output: `speak_and_return` speaks it via `ctx.speak` (same mechanism every
other node type uses) then continues to `next_node_id`; `silent_return`
never speaks it, only writes it into `turn_state[node.id]` for the parent
graph to use downstream — never auto-spoken (same convention every other
node's output is already referenceable by).

**`budget_ms` is self-enforced here**, unlike `SkillNode.budget_ms` (which
relies solely on the outer turn-level deadline already wrapping every
node's `execute()` call in `interpreter.py`/`registry.execute_one_node`) —
mirrors `RetrieveNode`'s own precedent of passing its own `budget_ms` into
an inner bound (see `nodes/retrieve.py`'s `run_retrieval_pipeline` call):
a slow delegated turn against a *different* tenant's LLM leg is exactly the
kind of failure mode this node's own declared budget exists to cut short,
independent of whatever is left of the parent turn's own budget. A
budget-exceeded cut is reported as a recognized node failure (`on_error`),
not `on_deadline` — this node has no SLA/server-resolved-timeout concept
the way a Hitl gate does, so there is no separate `on_deadline` case to
distinguish it from any other recognized failure (unresolvable target
tenant, persona fetch failure, no LLM available) — all four resolve
`on_error` uniformly, mirroring `skill.py`'s own defensive-logging-and-
`on_error`-return pattern exactly.
"""

from __future__ import annotations

import asyncio

import structlog

from avatar_agent.contracts.runtime_config import GraphNode, SubAgentNode
from avatar_agent.orchestration.failover import run_with_failover
from avatar_agent.orchestration.graph.edges import resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.ports.llm import ChatMessage, LlmChunk, ResidencyPayload, ToolCallRequest, ToolSpec
from avatar_agent.ports.orchestration import SubAgentPersona
from avatar_agent.ports.secrets import SecretNotFoundError, SecretStorePort
from avatar_agent.ports.tools import ToolDefinition, ToolError
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)

# Same bound `LlmNodeExecutor`/`SkillNodeExecutor`'s own tool round-trip
# uses — kept identical rather than introducing a second tuning knob.
_MAX_TOOL_ROUNDS = 1


def _resolve_subagent_tools(
    persona: SubAgentPersona, secrets: SecretStorePort | None
) -> tuple[list[ToolDefinition], list[ToolSpec]]:
    """Resolves a sub-agent persona's own `tool_definitions` into real
    `orchestration.tools.ToolDefinition`/`ToolSpec` pairs — mirrors
    `skill.py`'s own `_resolve_skill_tools` exactly (same resolve-
    credential-or-log-and-continue shape). Deliberately duplicated rather
    than imported: that function resolves a *skill's* tools, lazily, once
    per skill trigger; this resolves a *sub-agent persona's* tools, lazily,
    once per delegation target — a distinct lifecycle with the same small
    logic, and this codebase already accepts small duplication over a
    forced shared abstraction (see `skill.py`'s own docstring for the
    precedent this follows)."""
    definitions: list[ToolDefinition] = []
    specs: list[ToolSpec] = []
    for dto in persona.tool_definitions:
        api_key: str | None = None
        if dto.credential_ref is not None and secrets is not None:
            try:
                api_key = secrets.resolve(dto.credential_ref)
            except SecretNotFoundError:
                logger.warning(
                    "subagent_tool_credential_unresolvable", api_ref=dto.api_ref, target_tenant_id=persona.tenant_id
                )
        definitions.append(ToolDefinition(api_ref=dto.api_ref, name=dto.name, method=dto.method, url=dto.url, api_key=api_key))
        specs.append(ToolSpec(name=dto.name, description=dto.description or "", parameters=dto.args_schema))
    return definitions, specs


async def _consume_stream(stream, started_ms: int) -> tuple[str, int | None, list[ToolCallRequest]]:  # noqa: ANN001
    """Identical shape to `nodes/llm.py`/`nodes/skill.py`'s own
    `_consume_stream` — duplicated rather than imported (module-private in
    both; see `skill.py`'s docstring for the duplication rationale)."""
    first_token_ms: int | None = None
    reply_parts: list[str] = []
    tool_calls: list[ToolCallRequest] = []
    chunk: LlmChunk
    async for chunk in stream:
        if chunk["delta"]:
            reply_parts.append(chunk["delta"])
            if first_token_ms is None:
                first_token_ms = now_ms() - started_ms
        tool_calls.extend(chunk.get("tool_calls") or [])
    return "".join(reply_parts).strip(), first_token_ms, tool_calls


async def _run_delegated_turn(
    ctx: TurnContext,
    tool_specs: list[ToolSpec],
    tools_by_name: dict[str, ToolDefinition],
    residency: ResidencyPayload,
) -> tuple[str, int | None]:
    """Runs the delegated turn's LLM call, including one bounded round of
    the target persona's own tool calls (mirrors `SkillNodeExecutor`'s
    identical `_MAX_TOOL_ROUNDS = 1` round-trip) — factored out to a plain
    function (not a class method, matching `skill.py`'s all-functions-at-
    module-level style) so the whole thing sits inside this node's own
    `asyncio.wait_for(..., timeout=node.budget_ms / 1000)` in `execute`
    below, not just the first LLM call.
    """
    assert ctx.default_llm is not None
    started = now_ms()
    result = await run_with_failover(ctx.default_llm.primary, ctx.default_llm.fallback, ctx.default_llm.retry, tool_specs, residency)
    reply_text, first_token_ms, tool_calls = await _consume_stream(result.stream, started)

    rounds = 0
    while tool_calls and rounds < _MAX_TOOL_ROUNDS:
        messages: list[ChatMessage] = []
        for call in tool_calls:
            definition = tools_by_name.get(call["name"])
            if definition is None:
                logger.warning("subagent_tool_unknown", tool_name=call["name"])
                messages.append(ChatMessage(role="tool", content=f"Tool '{call['name']}' is not available."))
                continue
            try:
                result_text = await ctx.tool_executor.invoke(definition, call["arguments"])
            except ToolError as err:
                result_text = f"Tool '{call['name']}' failed: {err}"
            messages.append(ChatMessage(role="tool", content=result_text))
        residency = ResidencyPayload(
            system_prompt=residency.system_prompt,
            messages=tuple(residency.messages) + tuple(messages),
            retrieved_chunks=residency.retrieved_chunks,
        )
        result = await run_with_failover(ctx.default_llm.primary, ctx.default_llm.fallback, ctx.default_llm.retry, tool_specs, residency)
        followup_started = now_ms()
        reply_text, followup_first_token_ms, tool_calls = await _consume_stream(result.stream, followup_started)
        if first_token_ms is None:
            first_token_ms = followup_first_token_ms
        rounds += 1

    return reply_text, first_token_ms


def _failure(node: SubAgentNode, started: int, error_code: str) -> tuple[NodeResult, str | None]:
    return (
        NodeResult(
            node_id=node.id,
            node_type="subagent",
            lane=node.lane,
            status="failed",
            total_ms=now_ms() - started,
            error_code=error_code,
        ),
        resolve_on_error(node),
    )


class SubAgentNodeExecutor:
    """`NodeExecutor` for `type: subagent` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `SubAgentNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, SubAgentNode)
        started = now_ms()

        if ctx.subagent_persona_port is None:
            logger.warning("SUBAGENT_PERSONA_PORT_UNAVAILABLE", node_id=node.id)
            return _failure(node, started, "SUBAGENT_PERSONA_UNAVAILABLE")

        target_tenant_id = str(node.target_tenant_id)
        cache_key = f"{ctx.tenant_id}:{target_tenant_id}"
        persona = ctx.subagent_persona_cache.get(cache_key)
        if persona is None:
            try:
                persona = await ctx.subagent_persona_port.get_persona(target_tenant_id)
            except Exception:  # noqa: BLE001 - a lazy-fetch failure (incl. a 404 unresolvable target) is a recognized node failure, not a crash
                logger.warning("SUBAGENT_PERSONA_FETCH_FAILED", node_id=node.id, target_tenant_id=target_tenant_id)
                return _failure(node, started, "SUBAGENT_PERSONA_UNAVAILABLE")
            # Cached only on success — a transient fetch failure must not
            # poison the cache for the rest of the session (the next
            # delegation to this same target tenant gets a fresh attempt).
            ctx.subagent_persona_cache[cache_key] = persona

        if ctx.default_llm is None:
            logger.warning("SUBAGENT_NO_LLM_AVAILABLE", node_id=node.id)
            return _failure(node, started, "SUBAGENT_NO_LLM_AVAILABLE")

        tool_definitions, tool_specs = _resolve_subagent_tools(persona, ctx.secrets)
        tools_by_name = {t.name: t for t in tool_definitions}

        # Persona swap, not augmentation — see this module's docstring.
        # `ctx.residency` itself is never reassigned.
        scoped_residency = ResidencyPayload(
            system_prompt=persona.system_prompt,
            messages=ctx.residency.messages,
            retrieved_chunks=ctx.residency.retrieved_chunks,
        )

        try:
            reply_text, first_token_ms = await asyncio.wait_for(
                _run_delegated_turn(ctx, tool_specs, tools_by_name, scoped_residency), timeout=node.budget_ms / 1000
            )
        except TimeoutError:
            logger.warning("SUBAGENT_BUDGET_EXCEEDED", node_id=node.id, target_tenant_id=target_tenant_id)
            return _failure(node, started, "SUBAGENT_BUDGET_EXCEEDED")

        if node.handback_policy == "speak_and_return" and reply_text:
            await ctx.speak(reply_text)
            ctx.spoken = True
        # `silent_return`: never auto-spoken — the parent graph decides what
        # to do with it downstream, referencing it the same way any other
        # node's own output is already referenceable (`$<node_id>`).
        ctx.turn_state[node.id] = reply_text

        return (
            NodeResult(
                node_id=node.id,
                node_type="subagent",
                lane=node.lane,
                status="complete",
                total_ms=now_ms() - started,
                output_text=reply_text,
                first_token_ms=first_token_ms,
            ),
            node.next_node_id,
        )
