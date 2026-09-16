/**
 * api.md §5.2 rule 6: "`shj3-web` filters on the citizen path: internal ids
 * (`policyId`, `serverId`, `passageId`), cost fields, prompt text and raw
 * tool arguments never reach the browser."
 *
 * ## Deep-strip by field name, not a per-event-name path table
 *
 * A first draft of this file matched api.md §5.2's own illustrative wire
 * examples field-for-field (`guardrail.policyId`, `tool_call_started.
 * serverId`, …). The *real*, already-built `conversation_router.py`
 * (`apps/ai/src/shj3_ai/adapters/inbound/conversation_router.py`) produces a
 * materially different, honestly-scoped envelope shape for this pass — e.g.
 * `TraceStepOut.toolBindingId` where api.md's example shows a tool call's
 * `serverId`, and no top-level `sources`/`citation` objects at all yet. Per
 * this project's own recorded lesson ("a doc's worked example can be stale
 * relative to an already-tested sibling — check the real thing"), this
 * filter strips by **field name, recursively, wherever it appears** in a
 * decoded payload, rather than hard-coding which event name carries which
 * path. This is more robust to the real implementation's actual shape
 * (today's or a future revision's) than a brittle per-path table would be,
 * while still enforcing exactly the same rule: none of these names ever
 * reach the citizen, regardless of where in the object they occur.
 */

/** Every one of these keys is deleted wherever it appears, at any depth, in any event or the buffered turn envelope. */
const DENYLISTED_FIELD_NAMES: ReadonlySet<string> = new Set([
  "policyId",
  "serverId",
  "passageId",
  "toolBindingId",
  "agentVersionId",
  "costAed",
  "promptText",
  "systemInstructions",
  "systemPrompt",
]);

function stripDenylistedFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripDenylistedFields);
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(value)) {
      if (DENYLISTED_FIELD_NAMES.has(key)) continue;
      result[key] = stripDenylistedFields(nested);
    }
    return result;
  }
  return value;
}

/**
 * Filter one decoded JSON payload (an SSE frame's `data`, or the buffered
 * turn envelope) for the citizen path. Non-object/array input passes through
 * unchanged — none of the denylisted names can occur at a non-object's own
 * top level.
 *
 * Tool call *arguments* are masked, not removed — api.md §5.2's table says
 * `tool_call_started`'s `args` is "forwarded, masked", and the real pipeline
 * already sends a masked value (`"account_number": "••••4821"`, confirmed in
 * the wire example). `args`/`argumentsMasked` is deliberately absent from
 * `DENYLISTED_FIELD_NAMES` for exactly that reason — removing an
 * already-masked value here would duplicate a decision that belongs to the
 * pipeline that actually knows what is safe to mask.
 */
export function filterEventForCitizen(payload: unknown): unknown {
  if (typeof payload !== "object" || payload === null) return payload;
  return stripDenylistedFields(payload);
}
