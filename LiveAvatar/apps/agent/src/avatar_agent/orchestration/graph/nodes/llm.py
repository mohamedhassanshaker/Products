"""LLM node executor (Phase 9, BL-036).

Ports `pipeline.py`'s pre-Phase-9 `_process_utterance` LLM logic verbatim:
`run_with_failover` (FR-LLM-2 retry/fallback ladder) + stream consumption
(FR-LLM-4 `first_token_ms`) + one bounded round of model-requested tool
calls (FR-AGENT-2, `_MAX_TOOL_ROUNDS = 1`). This is the one node type whose
behavior must be byte-for-byte identical to the pre-Phase-9 pipeline for the
default single-LLM-node graph, so it is a port, not a rewrite.

`LlmUnavailableError` (both legs exhausted) is deliberately **not** caught
here — it propagates through `interpreter.py` uncaught, exactly as it did
before Phase 9, so `pipeline.py`'s existing `except LlmUnavailableError:
await self._enter_degraded_mode(...)` keeps working unchanged.
"""

from __future__ import annotations

import structlog

from avatar_agent.contracts.runtime_config import GraphNode, LlmNode
from avatar_agent.orchestration.failover import run_with_failover
from avatar_agent.orchestration.graph.ir import NodeResult, TurnContext
from avatar_agent.ports.llm import ChatMessage, LlmChunk, ToolCallRequest
from avatar_agent.telemetry.control_plane import now_ms

logger = structlog.get_logger(__name__)

_MAX_TOOL_ROUNDS = 1


async def _consume_stream(stream, started_ms: int) -> tuple[str, int | None, list[ToolCallRequest]]:  # noqa: ANN001
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


async def _apply_tool_calls(ctx: TurnContext, tool_calls: list[ToolCallRequest]) -> None:
    from avatar_agent.orchestration.tools import ToolError  # local import: avoids a cycle with `orchestration.tools`

    messages: list[ChatMessage] = []
    for call in tool_calls:
        definition = ctx.tools_by_name.get(call["name"])
        if definition is None:
            logger.warning("TOOL_UNKNOWN", tool_name=call["name"])
            messages.append(ChatMessage(role="tool", content=f"Tool '{call['name']}' is not available."))
            continue
        try:
            result_text = await ctx.tool_executor.invoke(definition, call["arguments"])
        except ToolError as err:
            result_text = f"Tool '{call['name']}' failed: {err}"
        messages.append(ChatMessage(role="tool", content=result_text))
    ctx.apply_tool_messages(messages)


class LlmNodeExecutor:
    """`NodeExecutor` for `type: llm` nodes."""

    async def execute(self, node: GraphNode, ctx: TurnContext) -> tuple[NodeResult, str | None]:
        # `node: GraphNode` (not `LlmNode`) to structurally satisfy the
        # `NodeExecutor` Protocol's parameter type (PEP 544 requires a
        # Protocol implementation's parameter types to be the same or wider,
        # never narrower) — `interpreter.py`'s `node.type`-keyed dispatch is
        # what guarantees this narrowing always succeeds at runtime.
        assert isinstance(node, LlmNode)
        resolved = ctx.llm_by_node.get(node.id)
        if resolved is None:
            # Config/runtime disagreement (a node the control plane's
            # runtime-config resolution didn't provide a provider for) —
            # treated as a node failure, not a crash; `on_error` decides
            # what happens next.
            return (
                NodeResult(
                    node_id=node.id,
                    node_type="llm",
                    lane=node.lane,
                    status="failed",
                    total_ms=0,
                    error_code="LLM_NODE_UNRESOLVED",
                ),
                None,
            )

        started = now_ms()
        result = await run_with_failover(resolved.primary, resolved.fallback, resolved.retry, ctx.tool_specs, ctx.residency)
        reply_text, first_token_ms, tool_calls = await _consume_stream(result.stream, started)

        rounds = 0
        while tool_calls and rounds < _MAX_TOOL_ROUNDS:
            await _apply_tool_calls(ctx, tool_calls)
            result = await run_with_failover(resolved.primary, resolved.fallback, resolved.retry, ctx.tool_specs, ctx.residency)
            followup_started = now_ms()
            reply_text, followup_first_token_ms, tool_calls = await _consume_stream(result.stream, followup_started)
            if first_token_ms is None:
                first_token_ms = followup_first_token_ms
            rounds += 1

        ctx.turn_state["_last_llm_output"] = reply_text
        node_result = NodeResult(
            node_id=node.id,
            node_type="llm",
            lane=node.lane,
            status="complete",
            total_ms=now_ms() - started,
            output_text=reply_text,
            provider_key=result.provider_key,
            used_fallback=result.used_fallback,
            first_token_ms=first_token_ms,
        )
        return node_result, node.next_node_id
