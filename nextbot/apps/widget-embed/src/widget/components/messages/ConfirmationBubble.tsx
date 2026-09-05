import { useState } from "react";
import { Button } from "@nextbot/ui/components/ui/button";
import type { ConfirmationPayload } from "@nextbot/contracts";
import { confirmToolCall, WidgetApiError } from "../../api.js";
import { useWidgetStore } from "../../store.js";

/**
 * A.2.10 — Confirmation / Action Card (FR-MCP-05 Tier 2, Phase 14/BL-08). Renders
 * the tool call's args-derived summary, and mutates its own local `state` in place
 * on decision — the widget's optimistic reflection of the one payload field the
 * backend also mutates in place (LLD §6.4); the AI's actual execution-result (or
 * failure) message arrives separately over SSE once the decision is processed.
 */
export function ConfirmationBubble({ payload }: { payload: ConfirmationPayload }) {
  const sessionToken = useWidgetStore((s) => s.sessionToken);
  const [state, setState] = useState(payload.state);
  const [pending, setPending] = useState<"Confirm" | "Cancel" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleDecision(decision: "Confirm" | "Cancel") {
    if (state !== "pending" || !sessionToken || pending) return;
    setPending(decision);
    setError(null);
    try {
      await confirmToolCall(sessionToken, payload.toolCallId, decision);
      setState(decision === "Confirm" ? "confirmed" : "cancelled");
    } catch (err) {
      // A 409 (already decided elsewhere, e.g. a duplicate click that raced a
      // prior one) or 410 (expired) still needs to reflect *some* terminal state
      // rather than leaving the buttons clickable forever.
      if (err instanceof WidgetApiError && err.status === 410) setState("expired");
      else setError("We couldn't process that just now — please try again.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="my-2 rounded-none border p-3" role="group" aria-label={payload.title}>
      <p className="mb-2 text-sm font-bold">{payload.title}</p>
      <div className="mb-2 flex flex-col gap-1">
        {payload.summary.map((field, i) => (
          <div key={i} className="flex justify-between text-sm">
            <span className="text-gray-600">{field.label}</span>
            <span className="font-medium">{field.value}</span>
          </div>
        ))}
      </div>
      {payload.disclaimer && <p className="mb-2 text-xs text-gray-500">{payload.disclaimer}</p>}
      {state === "pending" && (
        <div className="flex gap-2">
          <Button type="button" size="sm" disabled={!!pending} onClick={() => handleDecision("Confirm")}>
            {pending === "Confirm" ? "Confirming…" : "Confirm"}
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={!!pending} onClick={() => handleDecision("Cancel")}>
            {pending === "Cancel" ? "Cancelling…" : "Cancel"}
          </Button>
        </div>
      )}
      {state === "confirmed" && <p className="text-sm font-medium text-green-600">Confirmed — processing…</p>}
      {state === "cancelled" && <p className="text-sm font-medium text-gray-600">Cancelled.</p>}
      {state === "expired" && <p className="text-sm font-medium text-gray-600">This request has expired.</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
