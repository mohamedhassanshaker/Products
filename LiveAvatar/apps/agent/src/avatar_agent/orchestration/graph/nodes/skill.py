"""Skill node executor (Phase 13, BL-049/050/051; `ARCHITECTURE_NOTES.md`
§3.2/§5.3) — resolves and lazily injects a skill's body (instructions +
tools + knowledge filters), then runs one bounded LLM turn with those
resources attached.

**v1 scope decisions** (documented in `docs/plans/agent-builder-v2-plan.md`'s
Phase 13 "Decisions made this phase"):

1. **Plain LLM turn, not a nested sub-graph.** A `SkillVersion` carries no
   graph of its own this phase — the executor always runs "a plain LLM turn
   with the skill's tools/instructions attached" (one of A3.2/§3.2's two
   allowed shapes). A full nested-sub-graph-per-skill is a real, larger
   feature (its own node-id namespace, its own budget accounting, its own
   `on_error`/`on_deadline` semantics one level down) — deferred as a named
   follow-up, not built here.
2. **`trigger_mode` does not change this executor's runtime behavior.** A
   Skill node is always reached via ordinary deterministic graph wiring (a
   Router branch, or a plain `next_node_id` chain) — exactly like every
   other node type. True model-decided dynamic dispatch (the LLM choosing
   to "call" a skill mid-stream, the way it calls a tool) would require
   teaching the LLM node executor's own tool-calling round trip to
   recognize and route to a skill-shaped pseudo-tool call — a substantially
   larger change to `nodes/llm.py`'s core loop and the interpreter's
   control-flow model, out of BL-049/050/051's stated scope. `trigger_mode`
   is carried through as `SkillVersion` metadata for the builder's own
   latency-tradeoff messaging only (R-S2's UI-facing half); the runtime
   half is a documented Phase-14-or-later follow-up.

**R-S1/A5.2 "release on exit"** — the single most important behavioral
property of this node type: the injected instructions/tools are scoped to
this node's own local LLM call only.

- `ctx.residency` — itself already rebuilt fresh every `_process_utterance`
  call from the pipeline's *immutable* `_system_prompt` + *persistent*
  `SessionMemory` (see `pipeline.py`) — is **never mutated** by this
  executor. A fresh, turn-local `ResidencyPayload` (skill instructions
  appended to the system prompt for this call only) is built and discarded
  once the node returns.
- `SessionMemory` is never touched by any node executor at all — only
  `ConversationPipeline._process_utterance` writes to it, from the
  *final* turn reply text, after the whole graph walk completes. Since
  this executor never reaches `self._memory`/`self._system_prompt` (it has
  no access to them — `TurnContext` doesn't expose them), the injected
  instructions structurally cannot survive past this one node's own
  execution into any later turn.
- The skill body itself IS cached (`ctx.skill_body_cache`, per-session,
  per `ARCHITECTURE_NOTES.md` §5.3's "cached in-process for that session
  once triggered") — this is a *performance* cache for the lazy fetch, not
  a context leak: the cached `SkillBody`'s instructions are re-injected
  fresh into a new turn-local `ResidencyPayload` on every trigger, never
  left sitting in a persistent prompt/messages structure between turns.

See `tests/orchestration/graph/nodes/test_skill.py`'s
`test_release_on_exit_*` cases for the real, executed proof of this
property — not merely asserted in this docstring.
"""

from __future__ import annotations

import structlog

from avatar_agent.contracts.runtime_config import GraphNode, SkillNode
from avatar_agent.orchestration.failover import run_with_failover
from avatar_agent.orchestration.graph.edges import resolve_on_error
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.ports.llm import ChatMessage, LlmChunk, ResidencyPayload, ToolCallRequest, ToolSpec
from avatar_agent.ports.orchestration import SkillBody
from avatar_agent.ports.secrets import SecretNotFoundError, SecretStorePort
from avatar_agent.ports.tools import ToolDefinition, ToolError
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)

# Same bound `LlmNodeExecutor`/`entrypoint.py`'s tool round-trip uses —
# kept identical rather than introducing a second tuning knob.
_MAX_TOOL_ROUNDS = 1


def _resolve_skill_tools(body: SkillBody, secrets: SecretStorePort | None) -> tuple[list[ToolDefinition], list[ToolSpec]]:
    """Resolves a skill's own `tool_definitions` into real
    `orchestration.tools.ToolDefinition`/`ToolSpec` pairs — mirrors
    `entrypoint._resolve_tools`'s exact resolve-credential-or-log-and-continue
    shape. Deliberately duplicated here rather than imported: that function
    resolves `agent.tools[]` **once per session, upfront**; a skill's own
    tools are resolved **lazily, once per skill trigger** (and then cached
    alongside the rest of `SkillBody` — see `SkillNodeExecutor.execute`) —
    a genuinely different lifecycle, and the logic is small enough that
    sharing it would cost more indirection than it saves (this codebase
    already accepts small duplication in preference to a forced shared
    abstraction — e.g. the condition grammar duplicated verbatim between
    languages).
    """
    definitions: list[ToolDefinition] = []
    specs: list[ToolSpec] = []
    for dto in body.tool_definitions:
        api_key: str | None = None
        if dto.credential_ref is not None and secrets is not None:
            try:
                api_key = secrets.resolve(dto.credential_ref)
            except SecretNotFoundError:
                logger.warning("skill_tool_credential_unresolvable", api_ref=dto.api_ref, skill_id=body.skill_id)
        definitions.append(ToolDefinition(api_ref=dto.api_ref, name=dto.name, method=dto.method, url=dto.url, api_key=api_key))
        specs.append(ToolSpec(name=dto.name, description=dto.description or "", parameters=dto.args_schema))
    return definitions, specs


async def _consume_stream(stream, started_ms: int) -> tuple[str, int | None, list[ToolCallRequest]]:  # noqa: ANN001
    """Identical shape to `nodes/llm.py`'s own `_consume_stream` — duplicated
    rather than imported (that function is module-private); see this
    module's docstring for the duplication rationale."""
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


def _failure(node: SkillNode, started: int, error_code: str) -> tuple[NodeResult, str | None]:
    return (
        NodeResult(
            node_id=node.id,
            node_type="skill",
            lane=node.lane,
            status="failed",
            total_ms=now_ms() - started,
            error_code=error_code,
        ),
        resolve_on_error(node),
    )


class SkillNodeExecutor:
    """`NodeExecutor` for `type: skill` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # See `LlmNodeExecutor.execute`'s comment: `GraphNode` (not
        # `SkillNode`) to structurally satisfy the `NodeExecutor` Protocol.
        assert isinstance(node, SkillNode)
        started = now_ms()

        if not isinstance(node.version, int):
            # Defensive: `GetRuntimeConfigUseCase` always resolves a
            # `"latest"` reference to a concrete published version number
            # before this config ever reaches the agent (mirrors the
            # "resolve once per session" discipline this codebase already
            # applies to tools/the reasoning graph) — an unresolved
            # `"latest"` reaching here is a config/runtime disagreement,
            # not a recognized runtime condition.
            logger.warning("SKILL_VERSION_UNRESOLVED", node_id=node.id, skill_id=node.skill_id)
            return _failure(node, started, "SKILL_VERSION_UNRESOLVED")

        if ctx.skill_body_port is None:
            logger.warning("SKILL_BODY_PORT_UNAVAILABLE", node_id=node.id)
            return _failure(node, started, "SKILL_BODY_UNAVAILABLE")

        cache_key = f"{ctx.tenant_id}:{node.skill_id}@{node.version}"
        body = ctx.skill_body_cache.get(cache_key)
        if body is None:
            try:
                body = await ctx.skill_body_port.get_body(node.skill_id, node.version)
            except Exception:  # noqa: BLE001 - a lazy-fetch failure is a recognized node failure, not a crash
                logger.warning("SKILL_BODY_FETCH_FAILED", node_id=node.id, skill_id=node.skill_id)
                return _failure(node, started, "SKILL_BODY_UNAVAILABLE")
            # Cached only on success — a transient fetch failure must not
            # poison the cache for the rest of the session (the next
            # trigger gets a fresh attempt).
            ctx.skill_body_cache[cache_key] = body

        if ctx.default_llm is None:
            logger.warning("SKILL_NO_LLM_AVAILABLE", node_id=node.id)
            return _failure(node, started, "SKILL_NO_LLM_AVAILABLE")

        tool_definitions, tool_specs = _resolve_skill_tools(body, ctx.secrets)
        tools_by_name = {t.name: t for t in tool_definitions}

        # R-S1's "release on exit": a fresh, turn-local `ResidencyPayload`
        # for this skill's own LLM call(s) only — `ctx.residency` itself is
        # never reassigned (see this module's docstring).
        scoped_residency = ResidencyPayload(
            system_prompt=f"{ctx.residency.system_prompt}\n\n--- Skill: {body.name} ---\n{body.instructions}",
            messages=ctx.residency.messages,
            retrieved_chunks=ctx.residency.retrieved_chunks,
        )

        result = await run_with_failover(
            ctx.default_llm.primary, ctx.default_llm.fallback, ctx.default_llm.retry, tool_specs, scoped_residency
        )
        reply_text, first_token_ms, tool_calls = await _consume_stream(result.stream, started)

        rounds = 0
        while tool_calls and rounds < _MAX_TOOL_ROUNDS:
            messages: list[ChatMessage] = []
            for call in tool_calls:
                definition = tools_by_name.get(call["name"])
                if definition is None:
                    logger.warning("skill_tool_unknown", tool_name=call["name"], skill_id=body.skill_id)
                    messages.append(ChatMessage(role="tool", content=f"Tool '{call['name']}' is not available."))
                    continue
                try:
                    result_text = await ctx.tool_executor.invoke(definition, call["arguments"])
                except ToolError as err:
                    result_text = f"Tool '{call['name']}' failed: {err}"
                messages.append(ChatMessage(role="tool", content=result_text))
            scoped_residency = ResidencyPayload(
                system_prompt=scoped_residency.system_prompt,
                messages=tuple(scoped_residency.messages) + tuple(messages),
                retrieved_chunks=scoped_residency.retrieved_chunks,
            )
            result = await run_with_failover(
                ctx.default_llm.primary, ctx.default_llm.fallback, ctx.default_llm.retry, tool_specs, scoped_residency
            )
            followup_started = now_ms()
            reply_text, followup_first_token_ms, tool_calls = await _consume_stream(result.stream, followup_started)
            if first_token_ms is None:
                first_token_ms = followup_first_token_ms
            rounds += 1

        # Mirrors `LlmNodeExecutor`'s own `turn_state["_last_llm_output"]`
        # convention exactly — this is what lets a downstream `speak`-type
        # node (`mode: llm_output`) or the interpreter's own R-G1 implicit-
        # speak fallback treat a Skill node's reply the same way a plain
        # LLM node's reply is treated. `turn_state[node.id]` additionally
        # lets a downstream Tool node's `argument_mapping` reference this
        # node's own output by id (same convention `ToolNodeExecutor` sets
        # for itself).
        ctx.turn_state["_last_llm_output"] = reply_text
        ctx.turn_state[node.id] = reply_text

        node_result = NodeResult(
            node_id=node.id,
            node_type="skill",
            lane=node.lane,
            status="complete",
            total_ms=now_ms() - started,
            output_text=reply_text,
            provider_key=result.provider_key,
            used_fallback=result.used_fallback,
            first_token_ms=first_token_ms,
        )
        return node_result, node.next_node_id
